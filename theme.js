// Utilify theme engine (content script, runs at document_start).
//
// RSI colours its site with a blue palette spread across thousands of CSS declarations (design tokens
// and hard-coded values). To re-theme it we read RSI's own stylesheets, find every blue colour and
// write an override rule with the hue shifted. Reds, oranges and greens (sale prices, errors, buttons)
// are left alone. The generated CSS is cached so later page loads are themed from the first paint.
(() => {
  "use strict";
  const STYLE_ID = "utilify-theme-css";
  const VERSION = chrome.runtime.getManifest().version;
  // Bump BUILD whenever the recolouring logic changes. Saved results and saved "leave this image alone"
  // decisions are only trusted for the same VERSION + BUILD, so they can never outlive the code that made them.
  const BUILD = "4";
  const REV = VERSION + "." + BUILD;
  const HUE_MIN = 185, HUE_MAX = 232, SAT_MIN = 0.1; // what counts as "RSI blue"
  const ACCENT_MIN_SAT = 0.75, ACCENT_MIN_LIGHT = 0.4; // bright + saturated blue = accent, the rest = base
  const MIN_RULES_TO_TRUST = 10;                     // fewer than this means RSI's CSS hasn't loaded yet
  const COLOR_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\(\s*[\d.%\s,\/-]+\)/gi;
  const SKIP_PROPS = new Set(["content", "font-family", "quotes", "grid-template-areas", "src"]);

  // Other tools' interfaces on RSI pages are left exactly as their authors made them. Star Citizen
  // Hangar XPLORer adds its filter buttons, sort/search/pager and the total-spend panel inside these
  // two containers (and reuses RSI's old class names so they look native, which we must not recolour).
  const XPLOR_ROOTS = [".js-custom-controls", ".js-bulk-ui"];

  // Organization pages (/orgs/<SID>) belong to the organization: its owners pick their own colours and
  // background. So by default the org's content (#organization) and background (#post-background) are
  // left exactly as they are. A menu setting recolours the content too, but an organization page's
  // background is NEVER recoloured (not its image, not its big background layers, not canvases).
  const IS_ORG = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?orgs\/[^\/]+/i.test(location.pathname);
  const ORG_CONTENT_ROOTS = ["#organization", "#post-background"];
  const ORG_BG_ROOTS = ["#post-background"];
  let themeOrgs = false; // menu setting: "Recolour organization pages"
  let protectNot = "", protectedSel = "";
  function setProtected() {
    let roots = XPLOR_ROOTS.slice();
    if (IS_ORG) roots = roots.concat(themeOrgs ? ORG_BG_ROOTS : ORG_CONTENT_ROOTS);
    protectNot = ":not(" + roots.map((r) => r + "," + r + " *").join(",") + ")";
    protectedSel = roots.join(",");
  }
  setProtected();
  const TRAILING_PSEUDO_RE = /(::?(?:before|after|first-line|first-letter|marker|placeholder|selection|backdrop|-webkit-[\w-]+|-moz-[\w-]+)(?:\([^)]*\))?)$/i;

  const INLINE_ATTR = "data-utl-s";       // marks elements whose inline style has blue colours in it
  const INLINE_SEL = '[style*="rgb"],[style*="#"],[style*="url("]';
  const CANVAS_ATTR = "data-utl-c";       // marks big background <canvas> elements (animated backgrounds)
  const BG_ATTR = "data-utl-b";           // marks big background layers whose painted background we recoloured

  // Decorative background images (the blue lines, grids and galaxy patterns) are recoloured pixel by pixel.
  const IMG_STYLE_ID = "utilify-theme-img";
  const MAX_IMG_FETCHES = 40;             // per page load
  const MAX_IMG_BYTES = 8 * 1024 * 1024;  // skip bigger source files
  const MAX_DATA_URL_BYTES = 400 * 1024;  // skip bigger inline data: images
  const MAX_PIXELS = 40e6;                // skip bigger bitmaps (a 4K background is 8.3 million)
  const MAX_OUT_PIXELS = 16e6;            // bigger ones are recoloured at a slightly reduced size to keep memory sensible
  const TOTAL_CACHE_CHARS = 30e6;         // keep the saved copy of all recoloured images under this
  const IMG_HUE_MIN = 165, IMG_HUE_MAX = 240; // images judged "blue decoration" use a wider blue range than CSS colours
  // Chromium rejects a CSS variable whose value is over 2 MB (the image would silently fall back to the
  // original blue one), so every recoloured image is compressed to fit comfortably under that.
  const MAX_VAR_CHARS = 1.9e6;
  const imgDone = new Map();              // id -> recoloured data: URL (for the current theme)
  const imgSkip = new Set();              // ids that aren't blue decoration (photos, greys) or can't be handled
  const imgReport = new Map();            // id -> { url, status, detail } shown in the popup so problems can be diagnosed
  const skipInfo = new Map();             // id -> [url, reason] for the persisted skip list
  const imgFailed = new Set();            // ids we couldn't download this session
  const imgPending = new Map();           // id -> absolute url, found while building and not processed yet
  let imgStyleEl = null;
  let imgWorking = false;
  let imgFetches = 0;
  const knownInline = new Set();           // inline-style fingerprints we already have override rules for

  let theme = utilifyNormalizeTheme(null);
  let styleEl = null;
  let injectedFromCache = false;
  let cachedCss = "";
  let timer = null;

  // ---------- colour maths ----------
  function parseColor(str) {
    let r, g, b, a = 1;
    if (str[0] === "#") {
      let h = str.slice(1);
      if (h.length <= 4) h = [...h].map((c) => c + c).join("");
      r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
      if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
    } else {
      const parts = str.slice(str.indexOf("(") + 1, -1).split(/[\s,\/]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const ch = (x) => (x.endsWith("%") ? parseFloat(x) * 2.55 : parseFloat(x));
      [r, g, b] = parts.slice(0, 3).map(ch);
      if (parts[3] !== undefined) a = parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    }
    return [r, g, b, a].some(Number.isNaN) ? null : { r, g, b, a };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    return [r, g, b].map((v) => Math.round((v + m) * 255));
  }

  // RSI's blues come in two kinds: a dark "base" ramp (backgrounds, panels, text tints) and a bright,
  // highly saturated "accent" blue (buttons, links). A theme recolours each separately.
  // Returns [r, g, b], or null if this isn't one of RSI's blues.
  function shiftRgb(r, g, b, T, wide) {
    const [h, s, l] = rgbToHsl(r, g, b);
    if (s < SAT_MIN || h < (wide ? IMG_HUE_MIN : HUE_MIN) || h > (wide ? IMG_HUE_MAX : HUE_MAX)) return null;
    // RSI's older pages use a vivid cyan (about 190-198 degrees) for highlights and glows, often very dark
    // or faint. It's the same family as the accent blue, so it takes the accent colour.
    const cyan = h >= 186 && h <= 199 && s >= 0.7;
    if ((s >= ACCENT_MIN_SAT && l >= ACCENT_MIN_LIGHT) || cyan) { // accent
      const A = T.accent;
      return hslToRgb((h + (A.hue - UTILIFY_ACCENT_HUE) + 360) % 360, Math.min(1, s * A.sat * T.vibe), Math.min(0.97, l * A.lum));
    }
    const B = T.base; // surfaces: brightness change fades out towards light text tints so text stays readable
    const w = Math.min(1, Math.max(0, (0.55 - l) / 0.25));
    return hslToRgb((h + (B.hue - UTILIFY_BASE_HUE) + 360) % 360, Math.min(1, s * B.sat * T.vibe), Math.min(0.97, l * (1 + (B.lum - 1) * w)));
  }

  function shiftColor(c, T) {
    const rgb = shiftRgb(c.r, c.g, c.b, T);
    if (!rgb) return null;
    const [r, g, b] = rgb;
    return c.a < 1 ? "rgb(" + r + " " + g + " " + b + " / " + +c.a.toFixed(3) + ")" : "rgb(" + r + " " + g + " " + b + ")";
  }

  // RSI stores much of its palette as bare channel numbers, e.g. --orion-color-primary-4-rgb: 25,73,103
  // (used later as rgb(var(--...))). Shift those too.
  const CHANNEL_NAME_RE = /rgb|colou?r/i;
  const CHANNELS_RE = /^\s*(\d+(?:\.\d+)?)\s*([, ])\s*(\d+(?:\.\d+)?)\s*\2\s*(\d+(?:\.\d+)?)\s*$/;
  function shiftChannels(value, T) {
    const m = CHANNELS_RE.exec(value);
    if (!m) return null;
    const rgb = shiftRgb(+m[1], +m[3], +m[4], T);
    return rgb ? rgb.join(m[2] === "," ? "," : " ") : null;
  }

  // Returns the declaration value with its blue colours shifted (and decorative background images
  // swapped for their recoloured copies when ready), or null if nothing changed.
  // ctx = { images: bool, base: url, used: () => bool } is only given for background properties.
  function shiftValue(value, T, ctx) {
    const wantImages = !!(ctx && ctx.images && value.indexOf("url(") >= 0);
    if (value.indexOf("#") < 0 && value.indexOf("rgb") < 0 && !wantImages) return null;
    const parts = value.split(/(url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\))/); // never touch url(...) contents when recolouring colours
    let changed = false;
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i].replace(COLOR_RE, (m) => {
        const c = parseColor(m);
        const out = c && shiftColor(c, T);
        if (!out) return m;
        changed = true;
        return out;
      });
    }
    if (wantImages) {
      for (let i = 1; i < parts.length; i += 2) {
        const m = /^url\(\s*(["']?)([\s\S]*?)\1\s*\)$/.exec(parts[i]);
        const abs = m && imgCandidate(m[2], ctx.base);
        if (!abs) continue;
        const id = hashStr(abs.length > 300 ? abs.slice(0, 200) + abs.length + abs.slice(-60) : abs);
        if (imgDone.has(id)) { parts[i] = "var(--utl-i-" + id + "," + parts[i] + ")"; changed = true; } // original url is the fallback
        else if (!imgSkip.has(id) && !imgFailed.has(id) && ctx.used()) imgPending.set(id, abs);
      }
    }
    return changed ? parts.join("") : null;
  }

  // Walk the declarations in a style block's text. We parse the text rather than iterating the
  // browser's expanded properties, because a shorthand containing var() (e.g. a background that uses
  // rgba(var(--x), .4)) isn't expanded and would be invisible to us.
  function shiftDeclarations(cssText, T, base) {
    let out = "", depth = 0, quote = "", start = 0;
    const flush = (end) => {
      const decl = cssText.slice(start, end);
      start = end + 1;
      const c = decl.indexOf(":");
      if (c < 1) return;
      const name = decl.slice(0, c).trim();
      if (SKIP_PROPS.has(name)) return;
      const raw = decl.slice(c + 1).replace(/\s*!important\s*$/i, "").trim();
      const ctx = base && /^background(-image)?$/i.test(name) ? { images: true, base: base.url, used: base.used } : null;
      const nv = name.charCodeAt(0) === 45 && CHANNEL_NAME_RE.test(name)
        ? shiftChannels(raw, T) || shiftValue(raw, T)
        : shiftValue(raw, T, ctx);
      if (nv) out += name + ":" + nv + "!important;";
    };
    for (let i = 0; i < cssText.length; i++) {
      const ch = cssText[i];
      if (quote) { if (ch === quote && cssText[i - 1] !== "\\") quote = ""; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === ";" && depth === 0) flush(i);
    }
    flush(cssText.length);
    return out;
  }

  // ---------- inline styles ----------
  // Some of RSI's colours (like the page background gradient) are set in an element's style="..."
  // attribute, which a stylesheet rule can't select. We tag such elements with a fingerprint of their
  // style text and write a rule for that fingerprint. (Fingerprints are stable, so cached CSS still works.)
  function hashStr(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function tagInline(el) {
    const st = el.getAttribute && el.getAttribute("style");
    if (!st || (st.indexOf("rgb") < 0 && st.indexOf("#") < 0 && st.indexOf("url(") < 0)) return null;
    if (el.closest && el.closest(protectedSel)) return null; // someone else's UI: leave it alone
    const key = hashStr(st);
    if (el.getAttribute(INLINE_ATTR) !== key) el.setAttribute(INLINE_ATTR, key);
    return key;
  }

  // Only RSI's own stylesheets are recoloured, never another extension's or site's.
  function isRsiSheet(sheet) {
    const node = sheet.ownerNode;
    if (node && node.id && (node.id === STYLE_ID || /^HangarXPLOR/i.test(node.id))) return false;
    if (!sheet.href) return true; // inline <style>
    try {
      const host = new URL(sheet.href).hostname;
      return host === "robertsspaceindustries.com" || host.endsWith(".robertsspaceindustries.com");
    } catch (_) { return false; }
  }

  // Add ":not(<protected containers>)" to each selector so a rule never applies inside them
  function protectSelector(sel) {
    const parts = [];
    let depth = 0, quote = "", start = 0;
    for (let i = 0; i <= sel.length; i++) {
      const ch = sel[i];
      if (i === sel.length || (ch === "," && depth === 0 && !quote)) { parts.push(sel.slice(start, i)); start = i + 1; continue; }
      if (quote) { if (ch === quote && sel[i - 1] !== "\\") quote = ""; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
    }
    return parts.map((p) => {
      p = p.trim();
      const m = TRAILING_PSEUDO_RE.exec(p);
      return m ? p.slice(0, m.index) + protectNot + m[1] : p + protectNot;
    }).join(",");
  }

  // ---------- decorative background images ----------
  function imgCandidate(raw, base) {
    if (IS_ORG) return null; // an organization page's backgrounds are never recoloured
    if (/^data:image\/(png|jpeg|webp|svg\+xml)[;,]/i.test(raw)) return raw.length <= MAX_DATA_URL_BYTES * 1.4 ? raw : null; // small tiles inlined in the CSS
    try {
      const u = new URL(raw, base || location.href);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      const h = u.hostname; // RSI's own site and CDN only; user photos live on media.* and are never touched
      if (h !== "robertsspaceindustries.com" && h !== "cdn.robertsspaceindustries.com") return null;
      return /\.(png|jpe?g|webp|svg)$/i.test(u.pathname) ? u.href : null;
    } catch (_) { return null; }
  }

  // Is a rule's selector matched by anything on the page? (so we don't fetch images nothing uses)
  function selectorUsed(sel) {
    try { return !!document.querySelector(sel.replace(TRAILING_PSEUDO_RE, "") || "*"); } catch (_) { return true; }
  }

  function bytesFromDataUrl(url) {
    const c = url.indexOf(",");
    const meta = url.slice(5, c), body = url.slice(c + 1);
    const type = meta.split(";")[0];
    if (/;base64/i.test(meta)) {
      const bin = atob(body), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return { buf: u8.buffer, type };
    }
    return { buf: new TextEncoder().encode(decodeURIComponent(body)).buffer, type };
  }

  async function fetchBytes(url) {
    if (url.startsWith("data:")) { try { return bytesFromDataUrl(url); } catch (_) { return { skip: true }; } }
    try { // RSI's CDN normally allows this directly...
      const r = await fetch(url, { credentials: "omit" });
      if (r.ok) {
        if ((+r.headers.get("content-length") || 0) > MAX_IMG_BYTES) return { skip: true };
        const buf = await r.arrayBuffer();
        return buf.byteLength > MAX_IMG_BYTES ? { skip: true } : { buf, type: r.headers.get("content-type") || "" };
      }
    } catch (_) {}
    try { // ...otherwise ask the background script, which isn't subject to the page's CORS rules
      const res = await chrome.runtime.sendMessage({ type: "fetchImage", url, max: MAX_IMG_BYTES });
      if (res && res.skip) return { skip: true };
      if (res && res.ok) {
        const bin = atob(res.b64), u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return { buf: u8.buffer, type: res.type || "" };
      }
    } catch (_) {}
    return null;
  }

  // SVGs are recoloured as text: only colour attributes and CSS colour declarations are touched
  function recolorSvg(text, T) {
    let changed = false;
    const fix = (v) => { const nv = shiftValue(v, T); if (nv) { changed = true; return nv; } return v; };
    const PROPS = "fill|stroke|stop-color|flood-color|lighting-color|color";
    text = text.replace(new RegExp("\\b(" + PROPS + ")\\s*=\\s*([\"'])(.*?)\\2", "gi"), (m, a, q, v) => a + "=" + q + fix(v) + q);
    text = text.replace(new RegExp("\\b(" + PROPS + ")\\s*:\\s*([^;\"'}]+)", "gi"), (m, a, v) => a + ":" + fix(v.trim()));
    return changed ? text : null;
  }

  // toBlob() encodes off the main thread (toDataURL() freezes the page for a second or more on a 4K image)
  const toBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));
  const blobToDataUrl = (b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
  const yieldToPage = () => new Promise((r) => setTimeout(r, 0));
  const dataChars = (blob) => Math.ceil((blob.size * 4) / 3) + 40;

  // Encode to the smallest practical file under `limit` characters: lossless PNG if it fits, otherwise
  // high-quality WebP (which keeps transparency), and as a last resort a slightly smaller bitmap.
  async function encodeWithin(cv, limit) {
    let best = null;
    if (cv.width * cv.height <= 4e6) { // lossless PNG is only worth trying on smaller images (it's very slow on big ones)
      best = await toBlob(cv, "image/png");
      if (best && dataChars(best) <= Math.min(limit, 1.5e6)) return blobToDataUrl(best);
    }
    for (const q of cv.width * cv.height > 4e6 ? [0.85, 0.7, 0.55] : [0.92, 0.82, 0.7, 0.55]) { // big images: don't waste time on the top quality
      const w = await toBlob(cv, "image/webp", q);
      if (w && w.type === "image/webp" && (!best || w.size < best.size)) best = w;
      if (best && dataChars(best) <= limit) return blobToDataUrl(best);
    }
    for (let scale = 0.8; scale >= 0.3; scale *= 0.8) {
      const c2 = document.createElement("canvas");
      c2.width = Math.max(1, Math.round(cv.width * scale)); c2.height = Math.max(1, Math.round(cv.height * scale));
      c2.getContext("2d").drawImage(cv, 0, 0, c2.width, c2.height);
      const w = await toBlob(c2, "image/webp", 0.8);
      if (w && w.type === "image/webp" && dataChars(w) <= limit) return blobToDataUrl(w);
    }
    return null;
  }

  // Rasters (PNG/JPEG/WebP) are recoloured pixel by pixel, but only if their colour is overwhelmingly
  // RSI blue; photos and greyscale textures are left exactly as they are.
  // Big images are handled in horizontal bands so no single step freezes the page.
  // -> { data } | { skip: reason } | { fail: reason }
  async function recolorRaster(buf, type, T) {
    let bmp;
    try { bmp = await createImageBitmap(new Blob([buf], { type: type || "image/png" })); }
    catch (_) { return { fail: "the browser couldn't decode the image" }; }
    try {
      const w = bmp.width, h = bmp.height;
      if (!w || !h || w * h > MAX_PIXELS) return { skip: "image is very large (" + w + "x" + h + ")" };

      // 1. Is it blue decoration? Judge a small nearest-neighbour copy (real pixel colours, no blending).
      // Faint pixels count too: glows are often a vivid colour at 5-10% opacity.
      const sw = Math.min(w, 480), sh = Math.max(1, Math.min(h, Math.round((480 * h) / w)));
      const small = document.createElement("canvas");
      small.width = sw; small.height = sh;
      const sctx = small.getContext("2d", { willReadFrequently: true });
      sctx.imageSmoothingEnabled = false;
      sctx.drawImage(bmp, 0, 0, sw, sh);
      const sp = new Uint32Array(sctx.getImageData(0, 0, sw, sh).data.buffer);
      let visible = 0, chroma = 0, blue = 0;
      for (let i = 0; i < sp.length; i++) {
        const p = sp[i];
        if ((p >>> 24) < 3) continue;
        visible++;
        const [hh, ss] = rgbToHsl(p & 255, (p >>> 8) & 255, (p >>> 16) & 255);
        if (ss >= SAT_MIN) { chroma++; if (hh >= IMG_HUE_MIN && hh <= IMG_HUE_MAX) blue++; }
      }
      const pct = (n, d) => Math.round((100 * n) / Math.max(d, 1));
      // keep:true = a decision about the image's own content, safe to remember. Limits (size etc.) are never remembered.
      if (!visible) return { skip: "the image is empty/transparent", keep: true };
      if (chroma < visible * 0.01) return { skip: "it has almost no colour (grey texture)", keep: true };
      if (blue < chroma * 0.75) return { skip: "not mostly RSI-blue: only " + pct(blue, chroma) + "% of its coloured pixels are blue (photos are left alone)", keep: true };

      // 2. Recolour it band by band (very big images are shrunk a little first; they're only decoration)
      const scale = w * h > MAX_OUT_PIXELS ? Math.sqrt(MAX_OUT_PIXELS / (w * h)) : 1;
      const ow = Math.max(1, Math.round(w * scale)), oh = Math.max(1, Math.round(h * scale));
      const out = document.createElement("canvas");
      out.width = ow; out.height = oh;
      const octx = out.getContext("2d");
      const band = document.createElement("canvas");
      const bctx = band.getContext("2d", { willReadFrequently: true });
      const bandH = Math.max(16, Math.floor(3e5 / ow));
      // A fixed-size direct-mapped cache of colour -> recoloured colour (much faster than a Map for noisy images)
      const CACHE = 1 << 20;
      const ckey = new Int32Array(CACHE).fill(-1), cval = new Int32Array(CACHE);
      const t0 = performance.now();
      for (let y0 = 0; y0 < oh; y0 += bandH) {
        const bh = Math.min(bandH, oh - y0);
        band.width = ow; band.height = bh; // resizing also clears it
        bctx.drawImage(bmp, 0, y0 / scale, w, bh / scale, 0, 0, ow, bh);
        const img = bctx.getImageData(0, 0, ow, bh);
        const px = new Uint32Array(img.data.buffer); // little-endian: 0xAABBGGRR
        for (let i = 0; i < px.length; i++) {
          const p = px[i];
          if ((p >>> 24) === 0) continue;
          const key = p & 0xffffff;
          const slot = Math.imul(key, 2654435761) >>> 12;
          let o;
          if (ckey[slot] === key) o = cval[slot];
          else {
            const r = shiftRgb(key & 255, (key >>> 8) & 255, (key >>> 16) & 255, T, true);
            o = r ? (r[0] | (r[1] << 8) | (r[2] << 16)) : -1;
            ckey[slot] = key; cval[slot] = o;
          }
          if (o !== -1) px[i] = (p & 0xff000000) | o;
        }
        octx.putImageData(img, 0, y0);
        await yieldToPage(); // let the page run between bands
      }
      const t1 = performance.now();
      const data = await encodeWithin(out, MAX_VAR_CHARS);
      const secs = ((t1 - t0) / 1000).toFixed(1) + "s recolouring + " + ((performance.now() - t1) / 1000).toFixed(1);
      return data ? { data, size: w + "x" + h + (scale < 1 ? " (recoloured at " + ow + "x" + oh + ")" : "") + ", took " + secs + "s" } : { skip: "the recoloured image was too large for the browser even after compression" };
    } finally { if (bmp.close) bmp.close(); }
  }

  // -> { data, detail } recoloured | { skip: reason } not worth recolouring | { fail: reason } couldn't
  async function recolorImage(url, T) {
    const got = await fetchBytes(url);
    if (!got) return { fail: "couldn't download it" };
    if (got.skip) return { skip: "the file is too large" };
    const isSvg = /svg/i.test(got.type) || (!url.startsWith("data:") && /\.svg$/i.test(new URL(url).pathname));
    if (isSvg) {
      const text = recolorSvg(new TextDecoder().decode(got.buf), T);
      if (!text) return { skip: "the SVG has no RSI-blue colours in it", keep: true };
      const data = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
      return data.length <= MAX_VAR_CHARS ? { data, detail: "SVG" } : { skip: "the SVG is too large" };
    }
    const r = await recolorRaster(got.buf, got.type, T);
    return r.data ? { data: r.data, detail: r.size + (r.data.startsWith("data:image/webp") ? ", saved as WebP" : "") } : r;
  }

  function renderImgStyle() {
    if (!imgDone.size) { if (imgStyleEl) imgStyleEl.remove(); imgStyleEl = null; return; }
    if (!imgStyleEl || !imgStyleEl.isConnected) {
      imgStyleEl = document.getElementById(IMG_STYLE_ID) || document.createElement("style");
      imgStyleEl.id = IMG_STYLE_ID;
      (document.head || document.documentElement).appendChild(imgStyleEl);
    }
    let css = ":root{";
    imgDone.forEach((data, id) => { css += "--utl-i-" + id + ':url("' + data + '");'; });
    imgStyleEl.textContent = css + "}";
  }

  const shortUrl = (u) => {
    if (u.startsWith("data:")) return "inline image (" + Math.round(u.length / 1024) + " KB)";
    try { return new URL(u).pathname.split("/").slice(-3).join("/"); } catch (_) { return u.slice(0, 60); }
  };
  const report = (id, url, status, detail) => imgReport.set(id, { url: shortUrl(url), status, detail: detail || "" });

  function verifyImgVars() { // -> true if something had to be removed
    const root = getComputedStyle(document.documentElement);
    let removed = false;
    imgDone.forEach((data, id) => {
      if (!root.getPropertyValue("--utl-i-" + id)) { // the browser refused it
        imgDone.delete(id); removed = true;
        const r = imgReport.get(id);
        imgReport.set(id, { url: r ? r.url : id, status: "failed", detail: "the browser rejected the recoloured image (too large)" });
      }
    });
    return removed;
  }

  function persistImgs() {
    try {
      let total = 0;
      imgDone.forEach((d) => { total += d.length; });
      // "skip" decisions are remembered only for this version of the extension, so an update re-examines them
      const rec = { themeImgSkip: { v: REV, items: Object.fromEntries(skipInfo) } };
      if (total <= TOTAL_CACHE_CHARS) rec.themeImg = { key: keyOf(theme), items: Object.fromEntries(imgDone) };
      chrome.storage.local.set(rec);
    } catch (_) {}
  }

  async function processPending() {
    if (imgWorking) return;
    imgWorking = true;
    const startKey = keyOf(theme);
    let progressed = false;
    try {
      for (const [id, url] of [...imgPending]) {
        imgPending.delete(id);
        if (imgDone.has(id) || imgSkip.has(id) || imgFailed.has(id)) continue;
        if (imgFetches++ >= MAX_IMG_FETCHES) { report(id, url, "not processed", "too many images on this page"); break; }
        report(id, url, "working", "");
        let res;
        try { res = await recolorImage(url, theme); } catch (e) { res = { fail: "unexpected error: " + (e && e.message) }; }
        if (keyOf(theme) !== startKey) return; // theme changed while we were working: start over
        if (res.data) { imgDone.set(id, res.data); report(id, url, "recoloured", res.detail); }
        else if (res.skip) {
          if (res.keep) { imgSkip.add(id); skipInfo.set(id, [shortUrl(url), res.skip]); } // about the image itself: remember it
          else imgFailed.add(id);                                                          // a limit: just not again this visit
          report(id, url, "left alone", res.skip);
        }
        else { imgFailed.add(id); report(id, url, "failed", res.fail); } // not remembered: tried again next time
        progressed = true;
      }
    } finally { imgWorking = false; }
    if (progressed) { renderImgStyle(); if (verifyImgVars()) renderImgStyle(); persistImgs(); schedule(0); }
  }

  // ---------- big background layers, read from the page itself ----------
  // The stylesheet pass can't see a background that comes from a stylesheet the browser won't let us read
  // (e.g. served from another host without CORS), is set by a script, or is inlined. So we also look at
  // the page's big layers (html, body and the large wrappers just inside them) and recolour what they
  // actually paint. We read their ORIGINAL look by switching our own styles off for a moment.
  function stableSelector(el) {
    if (el === document.documentElement) return "html";
    if (el === document.body) return "body";
    let sel = null;
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) sel = "#" + el.id;
    else {
      const cls = [...el.classList].filter((c) => /^[A-Za-z_][\w-]*$/.test(c)).slice(0, 3);
      if (cls.length) sel = el.tagName.toLowerCase() + "." + cls.join(".");
    }
    try { return sel && document.querySelectorAll(sel).length === 1 ? sel : null; } catch (_) { return null; }
  }

  function bigBackgroundRules(T) {
    const out = [];
    if (IS_ORG) return out;
    const sheets = [styleEl, imgStyleEl].filter((e) => e && e.sheet);
    sheets.forEach((e) => { e.sheet.disabled = true; });
    try {
      const list = [document.documentElement, document.body];
      let frontier = [document.body];
      for (let depth = 0; depth < 5 && list.length < 800; depth++) {
        const next = [];
        for (const e of frontier) for (const c of e.children) { list.push(c); next.push(c); }
        frontier = next;
      }
      const minArea = innerWidth * innerHeight * 0.2;
      for (const el of list) {
        if (!el || !el.getBoundingClientRect || el.closest(protectedSel)) continue;
        const r = el.getBoundingClientRect();
        if (r.width * r.height < minArea) continue;
        const cs = getComputedStyle(el);
        const bi = cs.backgroundImage, bc = cs.backgroundColor;
        let decl = "";
        if (bi && bi !== "none") {
          const nv = shiftValue(bi, T, { images: true, base: document.baseURI, used: () => true });
          if (nv) decl += "background-image:" + nv + "!important;";
        }
        if (bc && bc !== "rgba(0, 0, 0, 0)" && bc !== "transparent") {
          const nv = shiftValue(bc, T);
          if (nv) decl += "background-color:" + nv + "!important;";
        }
        if (!decl) continue;
        const key = hashStr(bi + "|" + bc);
        el.setAttribute(BG_ATTR, key);
        const stable = stableSelector(el); // lets the cached theme apply before the element is scanned again
        out.push((stable ? stable + "," : "") + "[" + BG_ATTR + '="' + key + '"]{' + decl + "}");
      }
    } finally { sheets.forEach((e) => { e.sheet.disabled = false; }); }
    return out;
  }

  // ---------- build override CSS from RSI's own stylesheets ----------
  function build(T) {
    const chunks = [];
    let count = 0;

    // RSI's new design-system sheets (cig-tbl_*) never style other tools' legacy-class markup, so only
    // the older sheets need the protection (keeps the generated CSS small)
    const visit = (rules, wrappers, protect) => {
      for (const r of rules) {
        if (r instanceof CSSStyleRule) {
          const decl = shiftDeclarations(r.style.cssText, T, { url: (r.parentStyleSheet && r.parentStyleSheet.href) || document.baseURI, used: () => selectorUsed(r.selectorText) });
          if (decl) {
            count++;
            const sel = protect ? protectSelector(r.selectorText) : r.selectorText;
            chunks.push(wrappers.reduceRight((acc, w) => w + "{" + acc + "}", sel + "{" + decl + "}"));
          }
        } else if (r.cssRules && !(r instanceof CSSKeyframesRule)) { // @media, @supports, @container ...
          const text = r.cssText;
          visit(r.cssRules, wrappers.concat(text.slice(0, text.indexOf("{")).trim()), protect);
        } else if (r instanceof CSSImportRule && r.styleSheet && isRsiSheet(r.styleSheet)) {
          try { visit(r.styleSheet.cssRules, wrappers, protect); } catch (_) {}
        }
      }
    };

    for (const sheet of document.styleSheets) {
      if (!isRsiSheet(sheet)) continue;
      const protect = !(sheet.ownerNode && /^cig-tbl_/.test(sheet.ownerNode.id || ""));
      try { visit(sheet.cssRules, [], protect); } catch (_) { /* cross-origin sheet we can't read */ }
    }

    // Colours set directly in style="..." attributes
    const seen = new Set();
    document.querySelectorAll(INLINE_SEL).forEach((el) => {
      const key = tagInline(el);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const decl = shiftDeclarations(el.style.cssText, T, { url: document.baseURI, used: () => true });
      if (decl) { count++; chunks.push("[" + INLINE_ATTR + '="' + key + '"]{' + decl + "}"); }
    });
    seen.forEach((k) => knownInline.add(k));

    bigBackgroundRules(T).forEach((rule) => { count++; chunks.push(rule); });

    // Animated backgrounds are a <canvas> (we can't change its pixels), so tint it with a filter instead:
    // RSI's own background component, plus any other canvas that covers a big part of the window.
    if (!IS_ORG) document.querySelectorAll("canvas").forEach((cv) => {
      if (cv.closest(protectedSel)) return;
      const r = cv.getBoundingClientRect();
      if (r.width * r.height >= innerWidth * innerHeight * 0.4) cv.setAttribute(CANVAS_ATTR, "1");
    });
    const dh = T.base.hue - UTILIFY_BASE_HUE;
    const f = "{filter:hue-rotate(" + dh + "deg) saturate(" + +(T.base.sat * T.vibe).toFixed(3) + ") brightness(" + T.base.lum + ")!important}";
    if (!IS_ORG) chunks.push('[data-rsi-component="BackgroundRiveAnimation"] canvas' + f, "[" + CANVAS_ATTR + "]" + f);
    return { css: chunks.join("\n"), count };
  }

  // ---------- applying ----------
  function inject(css, count) {
    if (!styleEl || !styleEl.isConnected) {
      styleEl = document.getElementById(STYLE_ID) || document.createElement("style");
      styleEl.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    styleEl.textContent = css;
    if (count !== undefined) styleEl.dataset.rules = String(count);
  }

  function removeStyle() {
    if (styleEl) styleEl.remove();
    styleEl = null; injectedFromCache = false;
    imgDone.clear(); imgPending.clear(); renderImgStyle();
  }

  const keyOf = (T) => REV + "|" + JSON.stringify(T) + "|" + (IS_ORG ? (themeOrgs ? "orgOn" : "orgOff") : "std");
  const CSS_KEY = IS_ORG ? "themeCssOrg" : "themeCss"; // org pages are built differently, so they get their own saved copy

  function rebuild() {
    timer = null;
    if (utilifyThemeIsDefault(theme)) { removeStyle(); return; }
    const t0 = performance.now();
    document.querySelectorAll("[" + INLINE_ATTR + "],[" + BG_ATTR + "],[" + CANVAS_ATTR + "]").forEach((e) => {
      if (e.closest(protectedSel)) { e.removeAttribute(INLINE_ATTR); e.removeAttribute(BG_ATTR); e.removeAttribute(CANVAS_ATTR); }
    });
    const { css, count } = build(theme);
    if (count < MIN_RULES_TO_TRUST && injectedFromCache) return; // RSI's CSS isn't here yet: keep the cached theme
    inject(css, count);
    if (styleEl) styleEl.dataset.ms = String(Math.round(performance.now() - t0));
    injectedFromCache = false;
    if (imgPending.size) processPending(); // recolour decorative images; schedule() rebuilds when they're ready
    if (count >= MIN_RULES_TO_TRUST && css !== cachedCss) {
      cachedCss = css;
      try { chrome.storage.local.set({ [CSS_KEY]: { key: keyOf(theme), css, inline: [...knownInline] } }); } catch (_) {}
    }
  }

  function schedule(delay) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(rebuild, delay);
  }

  // RSI injects its stylesheets as the app starts up, so rebuild whenever new ones appear
  function watchStylesheets() {
    const isSheet = (n) => n.nodeType === 1 && (n.nodeName === "STYLE" || (n.nodeName === "LINK" && /stylesheet/i.test(n.rel))) && n.id !== STYLE_ID;
    // Tag new elements straight away (so cached rules apply before the next paint); rebuild if one is new to us
    const tagTree = (n) => {
      if (n.nodeType !== 1) return false;
      let fresh = false;
      const check = (el) => { const k = tagInline(el); if (k && !knownInline.has(k)) fresh = true; };
      check(n);
      if (n.querySelectorAll) n.querySelectorAll(INLINE_SEL).forEach(check);
      return fresh;
    };
    new MutationObserver((muts) => {
      if (utilifyThemeIsDefault(theme)) return;
      let rebuildNeeded = false;
      for (const m of muts) {
        if (m.target.nodeName === "STYLE" && m.target.id !== STYLE_ID) rebuildNeeded = true;
        for (const n of m.addedNodes) { if (isSheet(n)) rebuildNeeded = true; else if (tagTree(n)) rebuildNeeded = true; }
      }
      if (rebuildNeeded) schedule(250);
    }).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("load", (e) => { if (e.target && e.target.nodeName === "LINK") schedule(150); }, true);
    document.addEventListener("DOMContentLoaded", () => schedule(100));
    window.addEventListener("load", () => schedule(300));
  }

  async function start() {
    let s = {};
    try { s = await chrome.storage.local.get(["theme", "themeOrgs", CSS_KEY, "themeImg", "themeImgSkip"]); } catch (_) {}
    theme = utilifyNormalizeTheme(s.theme);
    themeOrgs = !!s.themeOrgs; setProtected();
    const saved = s[CSS_KEY];
    const sk = s.themeImgSkip;
    if (sk && !Array.isArray(sk) && sk.v === REV && sk.items) { // skip lists from older code are ignored
      Object.entries(sk.items).forEach(([id, info]) => { imgSkip.add(id); skipInfo.set(id, info); imgReport.set(id, { url: info[0], status: "left alone", detail: info[1] }); });
    }
    if (!utilifyThemeIsDefault(theme) && saved && saved.key === keyOf(theme)) {
      cachedCss = saved.css;
      (saved.inline || []).forEach((k) => knownInline.add(k));
      inject(cachedCss);          // themed from the very first paint
      injectedFromCache = true;
    }
    if (!IS_ORG && !utilifyThemeIsDefault(theme) && s.themeImg && s.themeImg.key === keyOf(theme)) {
      Object.entries(s.themeImg.items || {}).forEach(([id, d]) => { imgDone.set(id, d); imgReport.set(id, { url: "(remembered from an earlier visit)", status: "recoloured", detail: Math.round(d.length / 1024) + " KB" }); }); // also before first paint
      renderImgStyle();
    }
    watchStylesheets();
    schedule(0);

    // The popup asks for this to show what happened to each background image on the open page
    chrome.runtime.onMessage.addListener((msg, _sender, send) => {
      if (msg && msg.type === "utilImgReport") {
        send({
          version: VERSION, theme: theme.id, page: location.pathname, items: [...imgReport.values()],
          org: IS_ORG, orgRecolour: themeOrgs, rules: styleEl ? +styleEl.dataset.rules || 0 : 0, ms: styleEl ? +styleEl.dataset.ms || 0 : 0,
          protectedAreas: protectedSel,
        });
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !(changes.theme || changes.themeOrgs)) return;
      if (changes.theme) {
        theme = utilifyNormalizeTheme(changes.theme.newValue);
        imgDone.clear(); imgPending.clear(); imgFailed.clear(); imgFetches = 0; imgReport.clear(); renderImgStyle(); // images are recoloured per theme
      }
      if (changes.themeOrgs) { themeOrgs = !!changes.themeOrgs.newValue; setProtected(); }
      cachedCss = ""; injectedFromCache = false;
      schedule(0); // popup changed the theme / setting: apply right away
    });
  }
  start();
})();
