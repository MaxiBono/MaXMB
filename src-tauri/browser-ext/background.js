/* MaXMB Browser Helper — background script.
 *
 * The XMB app opens LibreWolf on a tiny local "bootstrap" page
 * (http://127.0.0.1:48219/xmb/open?t=TOKEN). When that tab appears this script:
 *   1. fetches the job (search text / URL / home + the panel geometry),
 *   2. marks that window as the XMB window (titlePreface "[XMB] ") so the
 *      app's userChrome rule hides the toolbars in THAT window only and the app
 *      can find it by title, and sizes it to the panel,
 *   3. opens the target: a search with YOUR default search engine, a URL, or
 *      your home page,
 *   4. polls the app for controller commands (back / forward / reload / address
 *      / search / close tab / type text) and reports title, URL and the hovered
 *      link so the app can draw its XMB info bars.
 * Your normal LibreWolf windows are never touched.
 */
"use strict";

const API = "http://127.0.0.1:48219";
const BOOT = API + "/xmb/open";
const PREFACE = "[XMB] ";

let xmbWindowId = null;
let focusFrame = null;            // { tabId, frameId } of the last focused text field
let pollTimer = null;
let pollFails = 0;
let polling = false;
let lastMeta = "";
let tabKey = "Tab";
let lastFs = false;               // the window in LibreWolf's own full screen (F11, a video's full screen button)               // the key (KeyboardEvent.code) for the next tab
const handled = new Set();

function post(path, body) {
  return fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  }).catch(() => {});
}

const LOCAL_RE = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$|\?|#)/i;
function looksLikeUrl(v) {
  if (/\s/.test(v)) return false;
  if (/^(https?|about|file|data|moz-extension):/i.test(v)) return true;
  if (LOCAL_RE.test(v)) return true;
  return /^[^/]+\.[a-z0-9-]{2,}(:\d+)?(\/|$|\?|#)/i.test(v);
}
function normalizeUrl(v) {
  v = String(v).trim();
  if (/^(https?|about|file|data|moz-extension):/i.test(v)) return v;
  return (LOCAL_RE.test(v) ? "http://" : "https://") + v;
}

async function doSearch(text, tabId) {
  try {
    await browser.search.query({ text, tabId });          // your default engine
  } catch (e) {
    try { await browser.search.search({ query: text, tabId }); } catch (e2) {}
  }
}

async function openTarget(tabId, windowId, mode, value) {
  try {
    const v = String(value || "").trim();
    if (mode === "search" && v) { await doSearch(v, tabId); return; }
    if (v) {
      if (looksLikeUrl(v)) await browser.tabs.update(tabId, { url: normalizeUrl(v) });
      else await doSearch(v, tabId);
      return;
    }
    // Internet Browser: your configured homepage if it's a web page, otherwise
    // the home page of YOUR default search engine (a normal web page you can
    // type in, rather than LibreWolf's own new-tab page).
    let home = "";
    try {
      const h = await browser.browserSettings.homepageOverride.get({});
      home = String((h && h.value) || "").split("|")[0].trim();
    } catch (e) {}
    if (!/^https?:\/\//i.test(home)) home = await engineHome();
    if (home) { await browser.tabs.update(tabId, { url: home }); return; }
    // unknown engine: run an empty-ish search, then step back to its front page
    await openEngineFrontPage(tabId);
  } catch (e) {}
}

const ENGINE_HOMES = [
  [/duckduckgo/i, "https://duckduckgo.com/"],
  [/google/i, "https://www.google.com/"],
  [/bing/i, "https://www.bing.com/"],
  [/startpage/i, "https://www.startpage.com/"],
  [/brave/i, "https://search.brave.com/"],
  [/qwant/i, "https://www.qwant.com/"],
  [/ecosia/i, "https://www.ecosia.org/"],
  [/mojeek/i, "https://www.mojeek.com/"],
  [/kagi/i, "https://kagi.com/"],
  [/metager/i, "https://metager.org/"],
  [/yahoo/i, "https://search.yahoo.com/"],
  [/yandex/i, "https://yandex.com/"],
  [/wikipedia/i, "https://www.wikipedia.org/"],
  [/searx|searxng/i, ""],            // instance-specific: found by the search trick
];
async function defaultEngine() {
  try {
    const list = await browser.search.get();
    return list.find((e) => e.isDefault) || null;
  } catch (e) { return null; }
}
async function engineHome() {
  const eng = await defaultEngine();
  if (!eng) return "";
  for (const [re, url] of ENGINE_HOMES) if (re.test(eng.name || "")) return url;
  return "";
}
// Run a search on the default engine, then send the tab to that site's front
// page (scheme + host) once the results URL is known.
async function openEngineFrontPage(tabId) {
  const done = new Promise((resolve) => {
    const fn = (id, info, tab) => {
      if (id !== tabId) return;
      const u = (info && info.url) || (tab && tab.url) || "";
      if (/^https?:\/\//i.test(u) && !u.startsWith(API)) {
        browser.tabs.onUpdated.removeListener(fn);
        resolve(new URL(u).origin + "/");
      }
    };
    browser.tabs.onUpdated.addListener(fn);
    setTimeout(() => { browser.tabs.onUpdated.removeListener(fn); resolve(""); }, 8000);
  });
  await doSearch("xmb", tabId);
  const front = await done;
  if (front) await browser.tabs.update(tabId, { url: front });
}

async function handleBoot(tab) {
  if (!tab || !tab.url || !tab.url.startsWith(BOOT) || handled.has(tab.id)) return;
  handled.add(tab.id);
  let job = null;
  try {
    const t = new URL(tab.url).searchParams.get("t") || "";
    const r = await fetch(API + "/xmb/job?t=" + encodeURIComponent(t), { cache: "no-store" });
    if (r.ok) job = await r.json();
  } catch (e) {}
  if (!job) return; // a stale bootstrap tab the app is no longer waiting for
  if (typeof job.tabKey === "string") tabKey = job.tabKey;

  xmbWindowId = tab.windowId;
  try {
    const w = await browser.windows.get(tab.windowId);
    if (w.state !== "normal") await browser.windows.update(tab.windowId, { state: "normal" });
  } catch (e) {}
  const upd = { titlePreface: PREFACE, focused: true };
  if (job.width > 0 && job.height > 0) {
    Object.assign(upd, { left: job.left, top: job.top, width: job.width, height: job.height });
  }
  try {
    await browser.windows.update(tab.windowId, upd);
  } catch (e) {
    try { await browser.windows.update(tab.windowId, { titlePreface: PREFACE }); } catch (e2) {}
  }
  post("/xmb/marked", { windowId: tab.windowId });
  startPolling();
  await openTarget(tab.id, tab.windowId, job.mode, job.value);
}

async function activeTab() {
  if (xmbWindowId == null) return null;
  try {
    const t = await browser.tabs.query({ windowId: xmbWindowId, active: true });
    return t[0] || null;
  } catch (e) { return null; }
}

async function reportMeta() {
  const tab = await activeTab();
  if (!tab) return;
  const meta = { title: tab.title || "", url: tab.url || "" };
  const s = JSON.stringify(meta);
  if (s === lastMeta) return;
  lastMeta = s;
  post("/xmb/meta", meta);
}

async function runCmd(c) {
  const tab = await activeTab();
  if (!tab || !c) return;
  try {
    switch (c.cmd) {
      case "back": await browser.tabs.goBack(tab.id); break;
      case "forward": await browser.tabs.goForward(tab.id); break;
      case "reload": await browser.tabs.reload(tab.id); break;
      case "navigate": {
        const v = String(c.value || "").trim();
        if (!v) break;
        if (looksLikeUrl(v)) await browser.tabs.update(tab.id, { url: normalizeUrl(v) });
        else await doSearch(v, tab.id);
        break;
      }
      case "search":
        if (c.value) await doSearch(String(c.value), tab.id);
        break;
      case "nexttab": case "prevtab": {
        const all = (await browser.tabs.query({ windowId: xmbWindowId })).sort((a, b) => a.index - b.index);
        if (all.length < 2) break;
        const i = all.findIndex((t) => t.id === tab.id);
        const n = all[(i + (c.cmd === "nexttab" ? 1 : all.length - 1)) % all.length];
        await browser.tabs.update(n.id, { active: true });
        break;
      }
      case "exitfullscreen":
        await browser.windows.update(xmbWindowId, { state: "normal" });
        break;
      // L3: LibreWolf's own full screen (the page is laid out for the whole screen)
      case "enterfullscreen":
        await browser.windows.update(xmbWindowId, { state: "fullscreen" });
        reportFs();
        break;
      case "closetab": {
        const all = await browser.tabs.query({ windowId: xmbWindowId });
        if (all.length > 1) await browser.tabs.remove(tab.id);
        break;
      }
      case "type": {
        const frameId = focusFrame && focusFrame.tabId === tab.id ? focusFrame.frameId : 0;
        await browser.tabs.sendMessage(tab.id,
          { type: "xmb-type", text: String(c.text || ""), replace: !!c.replace, enter: !!c.enter },
          { frameId });
        break;
      }
    }
  } catch (e) {}
}

// LibreWolf's own full screen (F11, or a video's full screen button): the
// app then lets the window fill the screen and the pointer go anywhere, as
// with L3
async function reportFs() {
  if (xmbWindowId == null) return;
  try {
    const w = await browser.windows.get(xmbWindowId);
    const fs = w.state === "fullscreen";
    if (fs !== lastFs) { lastFs = fs; post("/xmb/fs", { fullscreen: fs }); }
  } catch (e) {}
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const r = await fetch(API + "/xmb/poll", { cache: "no-store" });
    const d = await r.json();
    pollFails = 0;
    if (typeof d.tabKey === "string" && d.tabKey !== tabKey) {
      tabKey = d.tabKey;
      if (xmbWindowId != null) {
        try {
          for (const t of await browser.tabs.query({ windowId: xmbWindowId })) {
            browser.tabs.sendMessage(t.id, { type: "xmb-key", tabKey }).catch(() => {});
          }
        } catch (e) {}
      }
    }
    for (const c of d.cmds || []) await runCmd(c);
    await reportFs();
    if (d.open === false && xmbWindowId == null) stopPolling();
  } catch (e) {
    if (++pollFails > 40) stopPolling();      // app gone (~12 s)
  } finally {
    polling = false;
  }
}
function startPolling() {
  if (pollTimer) return;
  pollFails = 0;
  pollTimer = setInterval(poll, 300);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ---- events ---------------------------------------------------------------

browser.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (tab && tab.url && tab.url.startsWith(BOOT)) { handleBoot(tab); return; }
  if (tab && xmbWindowId != null && tab.windowId === xmbWindowId && tab.active &&
      (info.title !== undefined || info.url !== undefined || info.status !== undefined)) {
    reportMeta();
  }
});

browser.tabs.onActivated.addListener((info) => {
  if (info.windowId === xmbWindowId) {
    reportMeta();
    post("/xmb/hover", { href: "" });
  }
});

// Links / popups opened from the XMB window stay inside the XMB window.
browser.tabs.onCreated.addListener(async (tab) => {
  if (xmbWindowId == null || tab.windowId === xmbWindowId || tab.openerTabId == null) return;
  try {
    const opener = await browser.tabs.get(tab.openerTabId);
    if (opener.windowId !== xmbWindowId) return;
    await browser.tabs.move(tab.id, { windowId: xmbWindowId, index: -1 });
    await browser.tabs.update(tab.id, { active: true });
  } catch (e) {}
});

browser.tabs.onAttached.addListener((tabId, info) => {
  if (info.newWindowId === xmbWindowId) {
    browser.tabs.sendMessage(tabId, { type: "xmb-on", tabKey }).catch(() => {});
  }
});

browser.windows.onRemoved.addListener((windowId) => {
  if (windowId === xmbWindowId) {
    xmbWindowId = null;
    focusFrame = null;
    lastFs = false;
    lastMeta = "";
    stopPolling();
    post("/xmb/closed", {});
  }
});

browser.runtime.onMessage.addListener((m, sender) => {
  if (!m || !m.type) return;
  const tab = sender.tab;
  const inXmb = !!tab && xmbWindowId != null && tab.windowId === xmbWindowId;
  if (m.type === "hello") return Promise.resolve({ xmb: inXmb, tabKey });
  if (!inXmb) return;
  if (m.type === "nexttab") { runCmd({ cmd: "nexttab" }); return; }
  if (m.type === "focus") {
    if (m.focus) focusFrame = { tabId: tab.id, frameId: sender.frameId || 0 };
    post("/xmb/focus", {
      focus: !!m.focus, value: m.value || "", replace: !!m.replace, password: !!m.password,
    });
  } else if (m.type === "cursor") {
    post("/xmb/cursor", { mode: m.mode || "normal" });
  } else if (m.type === "hover") {
    if (tab.active) post("/xmb/hover", { href: m.href || "" });
  }
});

// On (re)start: adopt an XMB window that already exists, and handle any
// bootstrap tab that loaded before this script was ready.
(async () => {
  try {
    const wins = await browser.windows.getAll({});
    for (const w of wins) {
      if (w.title && w.title.startsWith(PREFACE.trim())) { xmbWindowId = w.id; startPolling(); break; }
    }
  } catch (e) {}
  try {
    const tabs = await browser.tabs.query({});
    for (const t of tabs) if (t.url && t.url.startsWith(BOOT)) handleBoot(t);
  } catch (e) {}
})();
