//! Web requests for the trophies, the linked accounts and Steam Friends,
//! through Windows' own curl.exe (as the game art does).
//!
//! The address, the headers and the body are handed to curl through its
//! standard input (a curl config, `-K -`), never on its command line: other
//! programs can read a program's command line, and the addresses here carry
//! keys and tokens (Steam Web API key, RetroAchievements key, store tokens).
//! Only https addresses are allowed.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

fn curl() -> Command {
    let mut c = Command::new(if cfg!(windows) { "curl.exe" } else { "curl" });
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);   // CREATE_NO_WINDOW
    }
    // (--proto: https only, also after a redirect)
    c.args(["-sSL", "--proto", "=https", "--proto-redir", "=https", "--compressed", "-A", "MaXMB/2.0", "-K", "-"]);
    c
}

/// A value inside a curl config line: in quotes, with \ and " escaped and no line breaks.
fn q(s: &str) -> String {
    let s: String = s.chars().filter(|c| *c != '\n' && *c != '\r').collect();
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

pub struct Resp { pub status: u16, pub body: Vec<u8> }
impl Resp {
    pub fn ok(&self) -> bool { (200..300).contains(&self.status) }
    pub fn text(&self) -> String { String::from_utf8_lossy(&self.body).into_owned() }
    pub fn json(&self) -> Option<serde_json::Value> { serde_json::from_slice(&self.body).ok() }
}

/// One request. `body`: sent as is (POST). `secs`: the most it may take.
pub fn request(method: &str, url: &str, headers: &[String], body: Option<&str>, secs: u32) -> Option<Resp> {
    if !url.starts_with("https://") { return None; }
    // (Steam's community pages refuse a computer that asks too much, for a while: they're
    // asked one at a time, 1.5 s apart at least; after a refusal (429) left alone, answering 429
    // here -- 2 minutes, then twice as long after each refusal in a row, 15 at most --, so the
    // refusal can end instead of being renewed)
    let community = url.starts_with("https://steamcommunity.com/");
    if community_resting() { if community { return Some(Resp { status: 429, body: Vec::new() }); } }
    let _pace = community.then(|| {
        let g = COMMUNITY_PACE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(t) = *g { let gap = std::time::Duration::from_millis(1500); if t.elapsed() < gap { std::thread::sleep(gap - t.elapsed()); } }
        g
    });
    let r = request_now(method, url, headers, body, secs);
    if let Some(mut g) = _pace { *g = Some(std::time::Instant::now()); }
    let r = r?;
    if community {
        let mut g = COMMUNITY_REST.lock().unwrap_or_else(|e| e.into_inner());
        if r.status == 429 {
            let pause = g.as_ref().map(|(_, p)| (*p * 2).min(std::time::Duration::from_secs(900))).unwrap_or(std::time::Duration::from_secs(120));
            crate::log::line("WARN", "steam", &format!("Steam's community pages refused (too many asked for): left alone for {} minutes", pause.as_secs() / 60));
            *g = Some((std::time::Instant::now(), pause));
        } else if r.ok() { *g = None; }
    }
    Some(r)
}
/// When Steam's community pages last refused, and for how long they're left alone since.
static COMMUNITY_REST: std::sync::Mutex<Option<(std::time::Instant, std::time::Duration)>> = std::sync::Mutex::new(None);
static COMMUNITY_PACE: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);
/// Whether Steam's community pages are being left alone now (they refused, 429).
pub fn community_resting() -> bool { COMMUNITY_REST.lock().unwrap_or_else(|e| e.into_inner()).map(|(t, p)| t.elapsed() < p).unwrap_or(false) }
fn request_now(method: &str, url: &str, headers: &[String], body: Option<&str>, secs: u32) -> Option<Resp> {
    let mut cfg = format!("url = {}\nrequest = {}\nmax-time = {}\nwrite-out = \"\\n%{{http_code}}\"\n", q(url), q(method), secs.max(3));
    for h in headers { cfg.push_str(&format!("header = {}\n", q(h))); }
    if let Some(b) = body { cfg.push_str(&format!("data-binary = {}\n", q(b))); }
    let mut child = curl().stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    child.stdin.take()?.write_all(cfg.as_bytes()).ok()?;
    let out = child.wait_with_output().ok()?;
    let mut body = out.stdout;
    // (the status code is the last line, see write-out)
    let cut = body.iter().rposition(|b| *b == b'\n')?;
    let status = String::from_utf8_lossy(&body[cut + 1..]).trim().parse::<u16>().ok()?;
    body.truncate(cut);
    Some(Resp { status, body })
}

/// One request whose answer's headers are wanted too (how old a store's answer is: Age, Date,
/// Cache-Control...): curl writes them before the answer (dump-header), the last block of
/// them (after any redirect) being the answer's. Their names in lower case.
pub fn request_with_headers(method: &str, url: &str, headers: &[String], secs: u32) -> Option<(Resp, Vec<(String, String)>)> {
    if !url.starts_with("https://") { return None; }
    let mut cfg = format!("url = {}\nrequest = {}\nmax-time = {}\ndump-header = \"-\"\nwrite-out = \"\\n%{{http_code}}\"\n", q(url), q(method), secs.max(3));
    for h in headers { cfg.push_str(&format!("header = {}\n", q(h))); }
    let mut child = curl().stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    child.stdin.take()?.write_all(cfg.as_bytes()).ok()?;
    let out = child.wait_with_output().ok()?;
    let mut all = out.stdout;
    let cut = all.iter().rposition(|b| *b == b'\n')?;
    let status = String::from_utf8_lossy(&all[cut + 1..]).trim().parse::<u16>().ok()?;
    all.truncate(cut);
    let (head, body) = split_headers(&all);
    Some((Resp { status, body }, head))
}
/// The headers' blocks at the start of what curl wrote (one per answer: a redirect's, then the
/// last one), and what follows them: the last block's headers, and the answer.
fn split_headers(all: &[u8]) -> (Vec<(String, String)>, Vec<u8>) {
    let mut at = 0usize;
    let mut last: Vec<(String, String)> = Vec::new();
    while all[at..].starts_with(b"HTTP/") {
        let Some(end) = all[at..].windows(4).position(|w| w == b"\r\n\r\n").map(|p| at + p + 4)
            .or_else(|| all[at..].windows(2).position(|w| w == b"\n\n").map(|p| at + p + 2)) else { break };
        last = String::from_utf8_lossy(&all[at..end]).lines().skip(1).filter_map(|l| {
            let (k, v) = l.split_once(':')?; Some((k.trim().to_lowercase(), v.trim().to_string()))
        }).collect();
        at = end;
    }
    (last, all[at..].to_vec())
}

pub fn get_json(url: &str, headers: &[String]) -> Option<serde_json::Value> {
    let r = request("GET", url, headers, None, 25)?;
    if r.ok() { r.json() } else { None }
}
pub fn post_json(url: &str, headers: &[String], body: &str) -> Option<serde_json::Value> {
    let r = request("POST", url, headers, Some(body), 25)?;
    if r.ok() { r.json() } else { None }
}

/// A picture saved to `to` (its folder must exist); false when it couldn't be.
pub fn download(url: &str, to: &Path) -> bool {
    if !url.starts_with("https://") { return false; }
    let part = to.with_extension("part");
    let cfg = format!("url = {}\noutput = {}\nmax-time = 40\nmax-filesize = 8000000\nfail\n", q(url), q(&part.display().to_string()));
    let Ok(mut child) = curl().stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() else { return false };
    if let Some(mut i) = child.stdin.take() { if i.write_all(cfg.as_bytes()).is_err() { return false; } }
    let ok = matches!(child.wait(), Ok(s) if s.success()) && std::fs::metadata(&part).map(|m| m.len() > 0).unwrap_or(false);
    if ok { let _ = std::fs::rename(&part, to); } else { let _ = std::fs::remove_file(&part); }
    ok && to.is_file()
}

/// Percent-encoding for a value in an address.
pub fn enc(s: &str) -> String {
    s.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
        _ => format!("%{b:02X}"),
    }).collect()
}
pub fn dec(s: &str) -> String {
    let b = s.as_bytes(); let mut out = Vec::with_capacity(b.len()); let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) { out.push(v); i += 3; continue; }
        }
        out.push(if b[i] == b'+' { b' ' } else { b[i] }); i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
/// One value of an address's query (?a=1&b=2).
pub fn query_val(url: &str, key: &str) -> Option<String> {
    let q = url.split_once('?')?.1.split('#').next()?;
    q.split('&').find_map(|kv| { let (k, v) = kv.split_once('=')?; (k == key).then(|| dec(v)) })
}
pub fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::new();
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 { s.push(if i <= c.len() { T[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' }); }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn helpers() {
        assert_eq!(q("a\"b\\c\nd"), "\"a\\\"b\\\\cd\"");
        assert_eq!(b64(b"ab:cd"), "YWI6Y2Q=");
        assert_eq!(b64(b"abc"), "YWJj");
        assert_eq!(query_val("https://x/y?code=A%2BB&z=1", "code").as_deref(), Some("A+B"));
        assert_eq!(enc("a b/c"), "a%20b%2Fc");
        assert!(request("GET", "http://example.com", &[], None, 5).is_none());
    }
}

/// Whether the internet can be reached (asked at most every 30 seconds): without
/// it, the trophies and Steam Friends use what's kept (trophies.rs, steamfriends.rs)
/// instead of waiting on the stores.
static LAST: std::sync::Mutex<Option<(std::time::Instant, bool)>> = std::sync::Mutex::new(None);
/// What the last check found (None: not checked yet), without checking now.
pub fn online_known() -> Option<bool> { LAST.lock().unwrap_or_else(|e| e.into_inner()).map(|(_, ok)| ok) }
pub fn online() -> bool {
    use std::time::Duration;
    use std::time::Instant;
    if let Some((t, ok)) = *LAST.lock().unwrap_or_else(|e| e.into_inner()) { if t.elapsed() < Duration::from_secs(30) { return ok; } }
    // (any answer from either: a working connection)
    let ok = ["https://www.google.com/generate_204", "https://www.cloudflare.com/cdn-cgi/trace"].iter()
        .any(|u| request("GET", u, &[], None, 4).map(|r| r.status > 0).unwrap_or(false));
    *LAST.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), ok));
    ok
}

#[cfg(test)]
mod header_tests {
    #[test]
    fn the_answer_s_own_headers_and_body() {
        let all = b"HTTP/1.1 302 Found\r\nLocation: x\r\n\r\nHTTP/2 200\r\nAge: 12\r\nCache-Control: max-age=30\r\n\r\n{\"items\":[]}";
        let (h, body) = super::split_headers(all);
        assert_eq!(body, b"{\"items\":[]}");
        assert!(h.contains(&("age".to_string(), "12".to_string())) && h.contains(&("cache-control".to_string(), "max-age=30".to_string())));
        assert!(!h.iter().any(|(k, _)| k == "location"), "the redirect's headers left out");
        let (h, body) = super::split_headers(b"{\"a\":1}");
        assert!(h.is_empty() && body == b"{\"a\":1}");
    }
}
