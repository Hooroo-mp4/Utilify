// RSI Utilify background script.
// Fetches and caches USD exchange rates (for every currency), checks GitHub for updates and opens the welcome tab.
// Content scripts ask us for rates because the page's own CORS rules would block them from calling the API.

const TTL_MS = 60 * 60 * 1000; // treat rates as fresh for 1 hour

async function fetchFreshRates() {
  // Primary source: every currency, updated about daily
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const json = await res.json();
    if (json.result === "success" && json.rates && json.rates.AUD) return json.rates;
  } catch (_) {}
  // Fallback source (ECB reference rates, about 30 major currencies)
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD");
    const json = await res.json();
    if (json.rates) return { USD: 1, ...json.rates };
  } catch (_) {}
  return null;
}

async function getRates(force = false) {
  const { rates, updated } = await chrome.storage.local.get(["rates", "updated"]);
  if (!force && rates && Date.now() - updated < TTL_MS) return rates;
  const fresh = await fetchFreshRates();
  if (fresh) {
    const merged = { ...(rates || {}), ...fresh }; // keep older rates for anything the fallback source lacks
    await chrome.storage.local.set({ rates: merged, updated: Date.now() });
    return merged;
  }
  return rates ?? null; // fall back to stale rates rather than nothing
}

// Downloads one of RSI's own decorative images for the theme engine (which recolours it). Only RSI's
// site and CDN are allowed, and big files are refused.
async function fetchImage(url, max) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || (u.hostname !== "robertsspaceindustries.com" && u.hostname !== "cdn.robertsspaceindustries.com")) return { ok: false };
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) return { ok: false };
    const limit = max || 3 * 1024 * 1024;
    if ((+res.headers.get("content-length") || 0) > limit) return { skip: true };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > limit) return { skip: true };
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { ok: true, type: res.headers.get("content-type") || "", b64: btoa(bin) };
  } catch (_) { return { ok: false }; }
}

// ---------- update check (GitHub releases) ----------
// On browser start the extension asks GitHub for the latest release of Hooroo-mp4/Utilify. If it's newer than
// the installed version, a tab opens with the details. Installs from a browser store update themselves, so
// they're skipped. It can be switched off in the menu ("Check for updates on browser start").
const REPO = "Hooroo-mp4/Utilify";
const RELEASE_API = "https://api.github.com/repos/" + REPO + "/releases/latest";

function parseVersion(str) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(str || "");
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function isNewer(a, b) { // is version a newer than version b? (both [major, minor, patch])
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}

async function fetchLatestRelease() {
  const res = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error("GitHub answered " + res.status);
  const j = await res.json();
  const v = parseVersion(j.tag_name) || parseVersion(j.name);
  if (!v) throw new Error("couldn't read a version from the release");
  return {
    version: v.join("."),
    name: j.name || j.tag_name,
    notes: j.body || "",
    url: j.html_url,
    published: j.published_at,
    assets: (j.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
    zipball: j.zipball_url,
  };
}

// manual = true when the person pressed "Check now" (always reports and always opens the details)
async function checkForUpdates(manual = false) {
  const s = await chrome.storage.local.get(["updateCheck", "updateSkipped"]);
  if (!manual) {
    if (s.updateCheck === false) return { skipped: "off" };
    try { const self = await chrome.management.getSelf(); if (self.installType === "normal") return { skipped: "store" }; } catch (_) {}
  }
  const latest = await fetchLatestRelease();
  const current = chrome.runtime.getManifest().version;
  const newer = isNewer(parseVersion(latest.version), parseVersion(current));
  await chrome.storage.local.set({ updateLast: { at: Date.now(), latest: latest.version } });
  if (newer && (manual || s.updateSkipped !== latest.version)) {
    await chrome.storage.local.set({ updateInfo: { ...latest, current } });
    chrome.tabs.create({ url: chrome.runtime.getURL("update.html") });
  }
  return { newer, latest: latest.version, current };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "checkUpdates") {
    checkForUpdates(true).then(sendResponse).catch((e) => sendResponse({ error: String((e && e.message) || e) }));
    return true;
  }
  if (msg && msg.type === "getRates") {
    getRates().then((rates) => sendResponse({ rates }));
    return true; // keep the channel open for the async response
  }
  if (msg && msg.type === "fetchImage") {
    fetchImage(msg.url, msg.max).then(sendResponse);
    return true;
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create("refresh-rates", { periodInMinutes: 60 });
  getRates(true);
  // Open the welcome tab on first install and after an update
  if (details.reason === "install" || details.reason === "update") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html?reason=" + details.reason) });
  }
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("refresh-rates", { periodInMinutes: 60 });
  checkForUpdates().catch(() => {}); // offline or GitHub unavailable: just try again next start
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "refresh-rates") getRates(true);
});
