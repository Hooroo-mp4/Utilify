(() => {
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT"]);

  // RSI can show prices in USD, EUR or GBP (its own currency switcher), so recognise all three, written as
  // "$49.50 USD", "€45.55 EUR", "£38.50 GBP", "45,55 €", "1.234,56 EUR", or just "686.40 USD" (no symbol,
  // as on Star Citizen Hangar XPLORer). Both "1,234.56" and "1.234,56" style numbers are understood.
  const PRICE_RE = /(?<![\w.,])([$€£]\s?)?(\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?!\d)(\s*[€£]|\s*[$€£]?\s*(?:USD|EUR|GBP)(?![\w-]))?/g;
  // A node that is only a number, e.g. "686.40" when the currency code lives in a separate element
  const NUM_ONLY_RE = /^[$€£]?\s?(\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+|\d+)(?:[.,]\d{1,2})?\s*[€£]?$/;
  const BARE_RE = /^([$€£]\s?)?(\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*([€£])?$/;
  const SOURCE_RE = /USD|EUR|GBP/;
  const LABEL_RE = /^(USD|EUR|GBP)$/;
  const SYM_TO_CODE = { "$": "USD", "€": "EUR", "£": "GBP" };

  const toAmount = (intPart, dec) => parseFloat(intPart.replace(/[.,\u00a0\u202f ]/g, "") + "." + (dec || "0"));

  // What a PRICE_RE match says: the amount, the currency it's in, and whether a symbol / code is present
  function parseMatch(m) {
    const post = m[4] || "";
    const sym = (m[1] ? m[1].trim() : "") || (/[€£]/.exec(post) || [""])[0];
    const code = (SOURCE_RE.exec(post) || [null])[0];
    return { amount: toAmount(m[2], m[3]), hasSym: !!sym, code, src: code || SYM_TO_CODE[sym] || "USD" };
  }

  // A number on its own (its currency code is in a neighbouring element)
  function parseBare(text, labelCode) {
    const m = BARE_RE.exec(text.trim());
    if (!m) return null;
    const sym = (m[1] ? m[1].trim() : "") || m[4] || "";
    return { amount: toAmount(m[2], m[3]), hasSym: !!sym, src: labelCode || SYM_TO_CODE[sym] || "USD" };
  }

  // Number/currency formatters for the chosen currency
  function makeFormats(code) {
    try {
      const narrow = new Intl.NumberFormat(undefined, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" });
      const plain = new Intl.NumberFormat("en-US", { style: "currency", currency: code, currencyDisplay: "symbol" });
      const d = narrow.resolvedOptions().maximumFractionDigits;
      const num = new Intl.NumberFormat(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
      // Some currencies (CHF, KWD ...) use their own code as the symbol; avoid showing "CHF 44.55 CHF"
      const codeSym = narrow.format(0).includes(code);
      return { narrow, plain, num, codeSym };
    } catch (_) { // unknown code: fall back to "123.45"
      const num = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return { narrow: num, plain: num, num, codeSym: true };
    }
  }
  const REDUCED_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ANIM = { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };

  let currency = "AUD";   // chosen in the popup; AUD by default
  let fmt = makeFormats(currency);
  let rates = null;       // { AUD: 1.42, JPY: 150.2, ... } per 1 USD
  let rate = null;        // rates[currency]
  let permanent = false;  // "always show converted prices" setting (popup toggle)

  // ---------- rate + settings ----------
  async function requestRates() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "getRates" });
      if (res && res.rates) setRates(res.rates);
    } catch (_) { /* extension was reloaded; refreshing the page fixes it */ }
  }

  const allPriceWraps = () => [...document.querySelectorAll(".utl-wrap:not(.utl-label)")].filter((w) => w._group);

  function setRates(newRates) {
    rates = newRates;
    const r = (rates && rates[currency]) || null;
    if (r === rate) return;
    rate = r;
    allPriceWraps().forEach((w) => { renderAlt(w); applyGroup(w._group, w._group.hover); });
  }

  function setCurrency(code) {
    if (!code || code === currency) return;
    currency = code;
    fmt = makeFormats(code);
    rate = (rates && rates[code]) || null;
    document.querySelectorAll(".utl-label").forEach(renderLabel);
    allPriceWraps().forEach((w) => { renderAlt(w); applyGroup(w._group, false); });
  }

  function setPermanent(value) {
    if (permanent === value) return;
    permanent = value;
    const wraps = [...allPriceWraps()];
    const animate = wraps.length <= 60; // don't animate hundreds of prices at once
    wraps.forEach((w) => applyGroup(w._group, animate));
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.rates && changes.rates.newValue) setRates(changes.rates.newValue);
      if (changes.currency && changes.currency.newValue) setCurrency(changes.currency.newValue);
      if (changes.permanent) setPermanent(!!changes.permanent.newValue);
    });
  } catch (_) {}

  function renderAlt(wrap) {
    const layer = wrap._altL;
    const amount = parseFloat(wrap.dataset.amt);
    const src = wrap.dataset.src || "USD"; // the currency RSI is showing this price in
    const srcRate = src === "USD" ? 1 : rates && rates[src];
    if (!rate || !srcRate || isNaN(amount)) { layer.textContent = "…"; return; }
    const value = (amount / srcRate) * rate; // source -> USD -> chosen currency
    const hasLabel = wrap.dataset.label === "1"; // separate "USD"/"EUR"/"GBP" element that flips to the currency code
    const suffix = wrap.dataset.suffix === "1";   // the code is part of the price text itself
    let text;
    if (wrap.dataset.sym === "1") {
      if (suffix) text = (fmt.codeSym ? fmt.num : fmt.narrow).format(value) + " " + currency;
      else if (hasLabel) text = (fmt.codeSym ? fmt.num : fmt.narrow).format(value);
      else text = fmt.plain.format(value); // nothing says which currency, so use an unambiguous symbol (A$, CA$, ¥ ...)
    } else {
      text = fmt.num.format(value) + (suffix ? " " + currency : "");
    }
    layer.textContent = text;
    if (wrap._split && wrap._view) fitSplitAlt(wrap);
  }

  // ---------- prices spread over several elements (e.g. RSI's animated "odometer" upgrade price) ----------
  // The upgrade price tag is built as <span>$</span><span><span>3</span><span>5</span><span>2</span><small>.00</small></span>
  // <span>USD</span>: one element per digit, so no single piece of text looks like a price. We don't move or
  // rewrap any of it (the site's animation holds on to those elements). Instead the container is tagged, a
  // hidden element with the converted text is added inside it, and showing the conversion hides the original
  // children and shows that element. The whole container swipes out and back in for the animation.
  const FULL_RE = /^([$€£])?(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?:(USD|EUR|GBP)|([€£]))?$/;

  function bigText(c) { // the element holding the biggest digits, so the converted text can match its look
    let best = c, bs = 0;
    c.querySelectorAll("*").forEach((e) => {
      if (e === c._altL || !/\d/.test(e.textContent)) return;
      const fs = parseFloat(getComputedStyle(e).fontSize) || 0;
      if (fs > bs) { bs = fs; best = e; }
    });
    return best;
  }

  function fitSplitAlt(c) {
    const alt = c._altL;
    const cs = getComputedStyle(bigText(c));
    alt.style.cssText = "font-size:" + cs.fontSize + ";font-weight:" + cs.fontWeight + ";font-family:" + cs.fontFamily +
      ";letter-spacing:" + cs.letterSpacing + ";line-height:" + cs.lineHeight + ";color:" + cs.color + ";white-space:nowrap";
    const w0 = c._origW || 0; // width the original price took up
    if (!w0 || !c.classList.contains("utl-split-on")) return;
    const w1 = alt.getBoundingClientRect().width;
    if (w1 > w0 * 1.1) alt.style.fontSize = Math.max(parseFloat(cs.fontSize) * 0.55, (parseFloat(cs.fontSize) * w0 * 1.1) / w1) + "px";
  }

  function swapSplit(c, toAlt, animate) {
    if (c._view === toAlt) return;
    c._view = toAlt;
    if (c._anims) c._anims.forEach((a) => a.cancel());
    c._anims = null;
    const seq = (c._seq = (c._seq || 0) + 1);
    const show = () => {
      if (toAlt) c._origW = c.getBoundingClientRect().width;
      c.classList.toggle("utl-split-on", toAlt);
      if (toAlt) fitSplitAlt(c);
    };
    if (!animate || REDUCED_MOTION || !c.animate) { show(); return; }
    const out = c.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-40%)", opacity: 0 }], { duration: 150, easing: "ease-in" });
    c._anims = [out];
    out.finished.then(() => {
      if (c._seq !== seq) return;
      show();
      const inn = c.animate([{ transform: "translateY(40%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 190, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      c._anims = [inn];
      inn.finished.then(() => { if (c._seq === seq) { c._anims = null; inn.cancel(); } }).catch(() => {});
    }).catch(() => {}); // cancelled by a newer swap
  }

  function buildSplitWrap(c, m) {
    const sym = m[1] || m[5] || "", code = m[4] || null;
    c.classList.add("utl-wrap", "utl-split");
    c.dataset.amt = String(toAmount(m[2], m[3]));
    c.dataset.src = code || SYM_TO_CODE[sym] || "USD";
    c.dataset.sym = sym ? "1" : "0";
    c.dataset.suffix = code ? "1" : "0";
    const alt = el("utl-split-alt");
    alt.setAttribute("aria-hidden", "true");
    c.appendChild(alt);
    c._altL = alt; c._usdL = c; c._view = false; c._split = true;
    const group = [c];
    group.hover = false;
    c._group = group;
    addHoverListeners(c);
    renderAlt(c);
    applyGroup(group, false);
  }

  function refreshSplit(c) { // the site changed the digits (e.g. a different upgrade was picked)
    let t = "";
    c.childNodes.forEach((n) => { if (n !== c._altL) t += n.textContent; });
    const m = FULL_RE.exec(t.replace(/\s+/g, ""));
    if (!m) return;
    const sym = m[1] || m[5] || "", code = m[4] || null;
    c.dataset.amt = String(toAmount(m[2], m[3]));
    if (sym || code) c.dataset.src = code || SYM_TO_CODE[sym] || "USD";
    renderAlt(c);
  }

  function scanSplitPrices(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const t = n.nodeValue.trim();
        return t && t.length <= 3 && (/^[$€£]$/.test(t) || LABEL_RE.test(t)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const anchors = [];
    while (walker.nextNode()) anchors.push(walker.currentNode);
    for (const a of anchors) {
      if (!a.isConnected || isSkippable(a)) continue;
      let c = a.parentElement;
      for (let i = 0; i < 4 && c && c !== document.body; i++, c = c.parentElement) {
        if (c.classList.contains("utl-wrap") || c.querySelector(".utl-wrap")) break; // already handled
        const compact = c.textContent.replace(/\s+/g, "");
        if (compact.length > 26) break;
        const m = FULL_RE.exec(compact);
        if (!m || !(m[1] || m[4] || m[5])) continue;
        let digitNodes = 0; // only when the digits really are spread over several nodes; otherwise the normal passes handle it
        const tw = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
        while (tw.nextNode()) if (/\d/.test(tw.currentNode.nodeValue)) digitNodes++;
        if (digitNodes < 2) continue;
        buildSplitWrap(c, m);
        break;
      }
    }
  }

  // The separate "USD" label flips to the currency code
  function renderLabel(lw) {
    if (lw._isEl) { if (lw._altL.firstChild) lw._altL.firstChild.textContent = currency; }
    else lw._altL.textContent = currency;
  }

  // ---------- showing USD vs the chosen currency ----------
  function inheritedDecoration(node) {
    for (let a = node.parentElement; a; a = a.parentElement) {
      const d = getComputedStyle(a).textDecorationLine;
      if (d && d !== "none") return d;
    }
    return "";
  }

  // Swap one wrapper between its USD layer and converted layer, with a swipe-up animation.
  //
  // Width handling: USD and converted text differ in width by a pixel or two, which would nudge neighbouring
  // text (and, in right-aligned rows like the cart, the price itself). So when leaving the "resting" view
  // (USD, or the converted price in always-convert mode) the box keeps its resting width if the new text is about the same
  // size ("hold"). If the new text is clearly wider/narrower (e.g. $99 -> $140) the box glides to the
  // new width instead.
  function swap(wrap, toAud, animate) {
    if (wrap._split) return swapSplit(wrap, toAud, animate);
    if (wrap._view === toAud) return;
    if (wrap._anims) wrap._anims.forEach((a) => a.cancel());
    const usdL = wrap._usdL, altL = wrap._altL;
    const inL = toAud ? altL : usdL;
    const outL = toAud ? usdL : altL;
    const heldW = parseFloat(wrap.style.width) || 0; // width we were holding, if any
    wrap._view = toAud;

    const settle = (holdW) => {
      wrap.classList.remove("utl-animating");
      wrap.style.clipPath = "";
      usdL.classList.remove("utl-incoming");
      altL.classList.remove("utl-incoming");
      wrap.classList.toggle("utl-show-alt", toAud);
      if (holdW) {
        wrap.classList.add("utl-locked");
        wrap.style.width = holdW + "px";
      } else {
        wrap.classList.remove("utl-locked");
        wrap.style.width = "";
        wrap.style.textDecoration = "";
      }
      wrap._anims = null;
    };

    if (!animate || REDUCED_MOTION || !wrap.animate) { settle(0); return; }

    outL.classList.remove("utl-incoming");
    inL.classList.add("utl-incoming");
    const deco = inheritedDecoration(wrap); // inline-blocks don't inherit strike-through, so copy it
    if (deco) wrap.style.textDecoration = deco;
    wrap.style.width = "";
    wrap.classList.add("utl-animating");
    wrap.style.clipPath = "inset(-0.1em -400px)"; // clip top/bottom only

    const wOut = heldW || outL.getBoundingClientRect().width;
    const wIn = inL.getBoundingClientRect().width;
    const resting = toAud === permanent; // are we swapping *to* the view the page rests in?
    const tol = (parseFloat(getComputedStyle(wrap).fontSize) || 16) * 0.5;
    const hold = !resting && Math.abs(wIn - wOut) <= tol ? wOut : 0;

    const anims = [
      outL.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-100%)", opacity: 0 }], ANIM),
      inL.animate([{ transform: "translateY(100%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], ANIM),
    ];
    if (hold) wrap.style.width = hold + "px";
    else anims.push(wrap.animate([{ width: wOut + "px" }, { width: wIn + "px" }], ANIM));
    wrap._anims = anims;
    Promise.all(anims.map((a) => a.finished)).then(() => {
      if (wrap._anims && wrap._anims[0] === anims[0]) { settle(hold); anims.forEach((a) => a.cancel()); }
    }).catch(() => {}); // cancelled by a newer swap
  }

  function wantAud(group) {
    return rate != null && permanent !== group.hover; // permanent mode: hovering peeks at USD
  }
  function applyGroup(group, animate) {
    const t = wantAud(group);
    group.forEach((w) => swap(w, t, animate));
  }

  // On RSI a crossed-out old price and the current price live in the same .m-price container
  // (side by side or stacked). Hovering either one flips both.
  function cluster(group) {
    const set = new Set([group]);
    const box = group[0] && group[0].closest && group[0].closest(".m-price");
    if (box) box.querySelectorAll(".utl-wrap:not(.utl-label)").forEach((w) => { if (w._group) set.add(w._group); });
    return [...set];
  }
  function enter(group) {
    cluster(group).forEach((g) => { clearTimeout(g.timer); g.hover = true; applyGroup(g, true); });
    requestRates(); // background script no-ops if the cached rate is fresh
  }
  function leave(group) {
    const gs = cluster(group);
    gs.forEach((g) => clearTimeout(g.timer));
    group.timer = setTimeout(() => gs.forEach((g) => { g.hover = false; applyGroup(g, true); }), 40);
  }
  // RSI draws the strike-through on a crossed-out price as an overlay line across the middle of its
  // .a-priceUnit, which would swallow the mouse. So for those, the whole unit is the hover target.
  const hoverTargets = new WeakSet();
  function addHoverListeners(w) {
    if (w._split) { // the container itself moves while it animates, so listen on its steady parent
      const t = w.parentElement || w;
      t.addEventListener("mouseenter", () => enter(w._group));
      t.addEventListener("mouseleave", () => leave(w._group));
      return;
    }
    const t = w.closest(".a-priceUnit.-before-discount") || w;
    if (hoverTargets.has(t)) return;
    hoverTargets.add(t);
    const groupOf = () => {
      const pw = t.matches(".utl-wrap") ? t : t.querySelector(".utl-wrap:not(.utl-label)");
      return pw && pw._group;
    };
    t.addEventListener("mouseenter", () => { const g = groupOf(); if (g) enter(g); });
    t.addEventListener("mouseleave", () => { const g = groupOf(); if (g) leave(g); });
  }

  // ---------- DOM helpers ----------
  const el = (cls) => { const s = document.createElement("span"); s.className = cls; return s; };

  function isSkippable(node) {
    const p = node.parentElement;
    if (!p || SKIP_TAGS.has(p.tagName) || p.isContentEditable) return true;
    return !!p.closest(".utl-wrap");
  }

  // Split off surrounding whitespace so the node is exactly its trimmed text
  function isolate(node) {
    const v = node.nodeValue;
    const lead = v.length - v.trimStart().length;
    const trail = v.length - v.trimEnd().length;
    let n = node;
    if (lead) n = n.splitText(lead);
    if (trail) n.splitText(n.nodeValue.length - trail);
    return n;
  }

  function buildPriceWrap(textNode, amount, hasSymbol, hasSuffix, src) {
    const wrap = el("utl-wrap");
    wrap.dataset.amt = String(amount);
    wrap.dataset.src = src || "USD";
    wrap.dataset.sym = hasSymbol ? "1" : "0";
    wrap.dataset.suffix = hasSuffix ? "1" : "0";
    const usdL = el("utl-layer utl-usd");
    const altL = el("utl-layer utl-alt");
    altL.setAttribute("aria-hidden", "true");
    textNode.parentNode.insertBefore(wrap, textNode);
    usdL.appendChild(textNode); // move (not copy) so the site's own references stay valid
    wrap.append(usdL, altL);
    wrap._usdL = usdL; wrap._altL = altL; wrap._view = false;
    const group = [wrap];
    group.hover = false;
    wrap._group = group;
    addHoverListeners(wrap);
    renderAlt(wrap);
    applyGroup(group, false); // in always-convert mode, new prices appear already converted
    return wrap;
  }

  function buildLabelWrap(label) {
    const lw = el("utl-wrap utl-label");
    const usdL = el("utl-layer utl-usd");
    const altL = el("utl-layer utl-alt");
    altL.setAttribute("aria-hidden", "true");
    let node = label;
    if (node.nodeType === Node.TEXT_NODE) {
      node = isolate(node);
    } else {
      const clone = node.cloneNode(false); // keeps classes/styling (e.g. small caps)
      clone.removeAttribute("id");
      altL.appendChild(clone);
      lw._isEl = true;
    }
    node.parentNode.insertBefore(lw, node);
    usdL.appendChild(node);
    lw.append(usdL, altL);
    lw._usdL = usdL; lw._altL = altL; lw._view = false;
    renderLabel(lw);
    return lw;
  }

  // A price "has a label" only if its paired USD label is still on the page
  const hasLiveLabel = (w) => !!w._group && w._group.some((x) => x !== w && x.isConnected);
  function pruneGroup(g) { g.splice(0, g.length, ...g.filter((x) => x.isConnected)); }

  function link(priceWrap, label) {
    if (hasLiveLabel(priceWrap)) return;
    pruneGroup(priceWrap._group);
    const lw = buildLabelWrap(label);
    priceWrap.dataset.label = "1";
    lw._group = priceWrap._group;
    lw._group.push(lw);
    addHoverListeners(lw);
    renderAlt(priceWrap);
    swap(lw, priceWrap._view, false); // match whatever the price is showing right now
  }

  // ---------- pass 1: find price text ----------
  function findMatch(text) {
    for (const m of text.matchAll(PRICE_RE)) {
      const p = parseMatch(m);
      const whole = text.trim() === m[0].trim();
      if ((p.hasSym && (p.code || whole)) || (!p.hasSym && p.code)) return m;
    }
    return null;
  }

  function wrapPrice(textNode) {
    if (!textNode.isConnected || isSkippable(textNode)) return;
    const m = findMatch(textNode.nodeValue);
    if (!m) return;
    let target = textNode;
    if (m.index > 0) target = textNode.splitText(m.index);
    const tail = target.nodeValue.length > m[0].length ? target.splitText(m[0].length) : null;
    const p = parseMatch(m);
    buildPriceWrap(target, p.amount, p.hasSym, !!p.code, p.src);
    if (tail) wrapPrice(tail);
  }

  // ---------- pass 2: pair separate "USD" labels with the price just before them ----------
  // Walks backwards through the page's text, so it doesn't matter how the site nests its elements.
  function findPriceBefore(startText, label) {
    let limit = label.nodeType === Node.ELEMENT_NODE ? label : label.parentElement;
    for (let i = 0; i < 4 && limit.parentElement && limit.parentElement !== document.body; i++) {
      limit = limit.parentElement;
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    walker.currentNode = startText;
    let t;
    while ((t = walker.previousNode())) {
      if (!limit.contains(t)) return null;
      if (!t.nodeValue.trim()) continue;
      const pe = t.parentElement;
      if (!pe) return null;
      if (pe.closest(".utl-alt")) continue;            // our own converted text
      if (SKIP_TAGS.has(pe.tagName)) continue;
      if (pe.closest(".utl-label")) return null;       // previous thing was another label
      const w = pe.closest(".utl-wrap");
      if (w) return !w._group || hasLiveLabel(w) || w.dataset.suffix === "1" ? null : { wrap: w };
      return NUM_ONLY_RE.test(t.nodeValue.trim()) ? { node: t } : null;
    }
    return null;
  }

  function scanLabels(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (SOURCE_RE.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const n of nodes) {
      if (!n.isConnected || isSkippable(n) || !LABEL_RE.test(n.nodeValue.trim())) continue;
      const code = n.nodeValue.trim();
      let label = n;
      const p = n.parentElement;
      if (p && p !== document.body && p.children.length === 0 && LABEL_RE.test(p.textContent.trim())) label = p;

      const found = findPriceBefore(n, label);
      if (!found) continue;
      if (found.wrap) { link(found.wrap, label); continue; }

      const bare = parseBare(found.node.nodeValue, code);
      if (!bare) continue;
      const wrap = buildPriceWrap(isolate(found.node), bare.amount, bare.hasSym, false, bare.src);
      link(wrap, label);
    }
  }

  // If the site re-renders a price (e.g. the cart subtotal after "Add to cart") our wrapper around the
  // number is discarded but the label wrapper survives. Pair each orphaned label with the new price.
  function relinkOrphanLabels(root) {
    root.querySelectorAll(".utl-label").forEach((lw) => {
      const g = lw._group;
      if (!g || (g[0] && g[0].isConnected)) return;
      const tw = document.createTreeWalker(lw._usdL, NodeFilter.SHOW_TEXT);
      const startText = tw.nextNode();
      if (!startText) return;
      const found = findPriceBefore(startText, lw);
      if (!found) return;
      let price = found.wrap;
      if (!price) {
        const bare = parseBare(found.node.nodeValue, lw._usdL.textContent.trim());
        if (!bare) return;
        price = buildPriceWrap(isolate(found.node), bare.amount, bare.hasSym, false, bare.src);
      }
      pruneGroup(price._group);
      price.dataset.label = "1";
      lw._group = price._group;
      price._group.push(lw);
      renderAlt(price);
      swap(lw, price._view, false);
    });
  }

  function scan(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      wrapPrice(root);
      root = root.parentElement;
      if (!root) return;
    } else if (root.nodeType !== Node.ELEMENT_NODE || SKIP_TAGS.has(root.tagName)) {
      return;
    } else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (/[$€£]|USD|EUR|GBP/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(wrapPrice);
    }
    // Labels can arrive separately from their number, so look a few levels up
    let labelRoot = root;
    for (let i = 0; i < 3 && labelRoot.parentElement && labelRoot.parentElement !== document.body; i++) {
      labelRoot = labelRoot.parentElement;
    }
    scanSplitPrices(labelRoot);
    scanLabels(labelRoot);
    relinkOrphanLabels(labelRoot);
  }

  // ---------- keep up with prices the site (or other extensions) render later ----------
  const queue = new Set();
  let timer = null;
  function enqueue(node) {
    queue.add(node);
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        const items = [...queue];
        queue.clear();
        items.forEach((n) => { if (n.isConnected) scan(n); });
      }, 100);
    }
  }

  function refreshWrapFromText(wrap) {
    const text = wrap._usdL.textContent;
    const m = [...text.matchAll(PRICE_RE)][0];
    if (!m) return;
    const p = parseMatch(m);
    wrap.dataset.amt = String(p.amount);
    if (p.code || p.hasSym) wrap.dataset.src = p.src; // the site may have switched currency
    renderAlt(wrap);
  }

  function observe() {
    new MutationObserver((mutations) => {
      for (const mu of mutations) {
        const tn = mu.target.nodeType === Node.ELEMENT_NODE ? mu.target : mu.target.parentElement;
        const sp = tn && tn.closest(".utl-split");
        if (sp) { if (!tn.closest(".utl-split-alt")) refreshSplit(sp); continue; }
        if (mu.type === "characterData") {
          // The site updated a price we've already wrapped (e.g. a total was recalculated)
          const pe = mu.target.parentElement;
          const w = pe && pe.closest(".utl-wrap:not(.utl-label)");
          if (w && pe.closest(".utl-usd")) refreshWrapFromText(w);
          else enqueue(mu.target);
        } else {
          mu.addedNodes.forEach((n) => {
            const host = n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement;
            if (host && host.closest(".utl-wrap")) return;
            enqueue(n);
          });
        }
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  async function init() {
    try {
      const s = await chrome.storage.local.get(["permanent", "currency", "rates"]);
      permanent = !!s.permanent;
      if (s.currency) { currency = s.currency; fmt = makeFormats(currency); }
      if (s.rates) { rates = s.rates; rate = rates[currency] || null; }
    } catch (_) {}
    observe();
    scan(document.body);
    requestRates();
  }
  init();
})();
