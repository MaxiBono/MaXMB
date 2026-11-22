// A PS3 disc image (.iso, as RPCS3 loads them): its files read straight from
// the image (ISO 9660), without mounting or extracting it. Only the small files
// the app needs are read: PS3_GAME's PARAM.SFO, its pictures, preview and music,
// and its TROPDIR (the game's trophy list), and PS3_DISC.SFB.
//
// A dumped disc (an "encrypted" ISO, with its .dkey) keeps these files in its
// first, unencrypted region; one that can't be read is left alone.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

const SECTOR: u64 = 2048;

/// One entry of a directory in the image.
#[derive(Debug, Clone)]
pub struct Entry { pub name: String, pub lba: u64, pub size: u64, pub dir: bool }

pub struct Iso { f: File, block: u64, root: Entry, len: u64 }

impl Iso {
    pub fn open(path: &Path) -> Option<Iso> {
        let mut f = File::open(path).ok()?;
        let len = f.metadata().ok()?.len();
        // (the primary volume descriptor: sector 16, "CD001")
        let mut pvd = [0u8; 2048];
        f.seek(SeekFrom::Start(16 * SECTOR)).ok()?;
        f.read_exact(&mut pvd).ok()?;
        if pvd[0] != 1 || &pvd[1..6] != b"CD001" { return None; }
        let block = u16::from_le_bytes([pvd[128], pvd[129]]) as u64;
        let block = if block == 0 { SECTOR } else { block };
        let root = record(&pvd[156..190])?;
        Some(Iso { f, block, root, len })
    }
    fn read_at(&mut self, lba: u64, size: u64, max: u64) -> Option<Vec<u8>> {
        let size = size.min(max);
        let start = lba.checked_mul(self.block)?;
        if start.checked_add(size)? > self.len { return None; }
        let mut b = vec![0u8; size as usize];
        self.f.seek(SeekFrom::Start(start)).ok()?;
        self.f.read_exact(&mut b).ok()?;
        Some(b)
    }
    /// A directory's entries (not "." and "..").
    pub fn list(&mut self, d: &Entry) -> Vec<Entry> {
        if !d.dir { return Vec::new(); }
        // (a directory larger than 4 MB isn't a game's)
        let Some(b) = self.read_at(d.lba, d.size, 4 << 20) else { return Vec::new() };
        let mut out = Vec::new();
        let mut i = 0usize;
        while i < b.len() {
            let n = b[i] as usize;
            // (records never cross a sector: a 0 length is the rest of this sector)
            if n == 0 { i = (i / SECTOR as usize + 1) * SECTOR as usize; continue; }
            if i + n > b.len() || n < 34 { break; }
            if let Some(e) = record(&b[i..i + n]) { if e.name != "." && e.name != ".." { out.push(e); } }
            i += n;
        }
        out
    }
    /// The entry at a path ("PS3_GAME/PARAM.SFO"), whatever the case of its names.
    pub fn find(&mut self, path: &str) -> Option<Entry> {
        let mut cur = self.root.clone();
        for part in path.split('/').filter(|p| !p.is_empty()) {
            cur = self.list(&cur).into_iter().find(|e| e.name.eq_ignore_ascii_case(part))?;
        }
        Some(cur)
    }
    /// A file's bytes (at most `max`).
    pub fn read(&mut self, e: &Entry, max: u64) -> Option<Vec<u8>> {
        if e.dir || e.size > max { return None; }
        self.read_at(e.lba, e.size, max)
    }
}

fn record(r: &[u8]) -> Option<Entry> {
    if r.len() < 34 { return None; }
    let lba = u32::from_le_bytes([r[2], r[3], r[4], r[5]]) as u64;
    let size = u32::from_le_bytes([r[10], r[11], r[12], r[13]]) as u64;
    let dir = r[25] & 2 != 0;
    let nl = r[32] as usize;
    let raw = r.get(33..33 + nl)?;
    let name = match raw { [0] => ".".to_string(), [1] => "..".to_string(),
        _ => { let s = String::from_utf8_lossy(raw).to_string(); s.split(';').next().unwrap_or("").trim_end_matches('.').to_string() } };
    Some(Entry { name, lba, size, dir })
}

/// The Title ID in a PS3_DISC.SFB (its "TITLE_ID" field: BLUS12345-…).
pub fn sfb_title_id(b: &[u8]) -> Option<String> {
    if b.get(0..4)? != b".SFB" { return None; }
    let at = b.windows(8).position(|w| w == b"TITLE_ID")?;
    // (the field's place and length after its name: 16 bytes for the name, then both, big-endian)
    let off = u32::from_be_bytes(b.get(at + 16..at + 20)?.try_into().ok()?) as usize;
    let len = u32::from_be_bytes(b.get(at + 20..at + 24)?.try_into().ok()?) as usize;
    let v = b.get(off..off + len.min(64))?;
    let s: String = String::from_utf8_lossy(v).chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
    (s.len() == 9).then_some(s)
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// A small ISO 9660 image: directories and files at the given paths.
    pub fn make_iso(files: &[(&str, &[u8])]) -> Vec<u8> {
        // (every directory and file gets its own sectors, from sector 20)
        use std::collections::BTreeMap;
        let mut dirs: BTreeMap<String, Vec<(String, bool)>> = BTreeMap::new();
        dirs.insert(String::new(), Vec::new());
        for (p, _) in files {
            let parts: Vec<&str> = p.split('/').collect();
            for i in 0..parts.len() {
                let parent = parts[..i].join("/");
                let me = parts[..=i].join("/");
                let is_dir = i + 1 < parts.len();
                let list = dirs.entry(parent).or_default();
                if !list.iter().any(|(n, _)| *n == me) { list.push((me.clone(), is_dir)); }
                if is_dir { dirs.entry(me).or_default(); }
            }
        }
        let mut lba: BTreeMap<String, (u64, u64)> = BTreeMap::new();
        let mut next = 20u64;
        for d in dirs.keys() { lba.insert(d.clone(), (next, SECTOR)); next += 1; }
        for (p, data) in files { let n = (data.len() as u64).div_ceil(SECTOR).max(1); lba.insert(p.to_string(), (next, data.len() as u64)); next += n; }
        let mut img = vec![0u8; (next * SECTOR) as usize];
        let rec = |name: &[u8], at: (u64, u64), dir: bool| -> Vec<u8> {
            let mut r = vec![0u8; 33 + name.len() + (1 - name.len() % 2)];
            r[0] = r.len() as u8;
            r[2..6].copy_from_slice(&(at.0 as u32).to_le_bytes());
            r[10..14].copy_from_slice(&(at.1 as u32).to_le_bytes());
            r[25] = if dir { 2 } else { 0 };
            r[32] = name.len() as u8;
            r[33..33 + name.len()].copy_from_slice(name);
            r
        };
        // the volume descriptor
        let pvd = (16 * SECTOR) as usize;
        img[pvd] = 1; img[pvd + 1..pvd + 6].copy_from_slice(b"CD001");
        img[pvd + 128..pvd + 130].copy_from_slice(&(SECTOR as u16).to_le_bytes());
        let root = rec(&[0], lba[""], true);
        img[pvd + 156..pvd + 156 + 34].copy_from_slice(&root[..34]);
        for (d, list) in &dirs {
            let mut at = (lba[d].0 * SECTOR) as usize;
            for x in [rec(&[0], lba[d], true), rec(&[1], lba[d], true)] { img[at..at + x.len()].copy_from_slice(&x); at += x.len(); }
            for (child, is_dir) in list {
                let name = child.rsplit('/').next().unwrap();
                let n = if *is_dir { name.to_string() } else { format!("{name};1") };
                let x = rec(n.as_bytes(), lba[child], *is_dir);
                img[at..at + x.len()].copy_from_slice(&x); at += x.len();
            }
        }
        for (p, data) in files { let at = (lba[*p].0 * SECTOR) as usize; img[at..at + data.len()].copy_from_slice(data); }
        img
    }

    #[test]
    fn reads_files_from_an_image() {
        let img = make_iso(&[("PS3_GAME/PARAM.SFO", b"\0PSFdata"), ("PS3_GAME/TROPDIR/NPWR01234_00/TROPHY.TRP", b"trp"), ("PS3_DISC.SFB", b".SFB")]);
        let p = std::env::temp_dir().join(format!("xmb-iso-{}.iso", std::process::id()));
        std::fs::write(&p, &img).unwrap();
        let mut iso = Iso::open(&p).unwrap();
        let e = iso.find("ps3_game/param.sfo").unwrap();
        assert_eq!(iso.read(&e, 1 << 20).unwrap(), b"\0PSFdata");
        let t = iso.find("PS3_GAME/TROPDIR").unwrap();
        assert_eq!(iso.list(&t).iter().map(|e| e.name.clone()).collect::<Vec<_>>(), vec!["NPWR01234_00"]);
        assert!(iso.find("PS3_GAME/USRDIR").is_none());
        // (not an image: nothing)
        std::fs::write(&p, b"not an iso").unwrap();
        assert!(Iso::open(&p).is_none());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn title_id_from_the_disc_file() {
        let mut b = vec![0u8; 0x300];
        b[0..4].copy_from_slice(b".SFB");
        b[0x20..0x28].copy_from_slice(b"TITLE_ID");
        b[0x30..0x34].copy_from_slice(&0x220u32.to_be_bytes());
        b[0x34..0x38].copy_from_slice(&0x10u32.to_be_bytes());
        b[0x220..0x230].copy_from_slice(b"BLUS30443-ABCDEF");
        assert_eq!(sfb_title_id(&b).as_deref(), Some("BLUS30443"));
        assert_eq!(sfb_title_id(b"nope"), None);
    }
}
