// RSI Utilify: slideshow control, page side.
// Runs in the page's own context (not the extension's), because the site's image slideshows are Swiper
// carousels and their autoplay can only be reached through the Swiper object the page created.
//  - On product pages (/pledge/<something>, NOT the /pledge store front, which needs its slideshow to cycle)
//    it tags slideshows that play by themselves with data-utl-autoplay="1" so the extension can add its
//    Pause button, and pauses / resumes them when <html data-utl-slides="paused|playing"> changes.
//  - It PAUSES autoplay (Swiper's pause/resume) rather than stopping it, so the site never sees a stopped
//    slideshow it might restart. If something keeps resuming a slideshow anyway, it backs off instead of
//    fighting (fighting is what made pages laggy).
//  - It never starts a slideshow that wasn't auto-playing, does no work on other pages, and sends nothing.
(() => {
  "use strict";
  if (window.__utilifySlides) return;
  window.__utilifySlides = true;

  const ROOT = document.documentElement;
  const PRODUCT_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?pledge\/[^/]+/i; // /en/pledge/... but not /en/pledge itself
  const MAX_REPAUSES = 3, WINDOW_MS = 10000;           // more re-pauses than this in 10 s = give up on that slideshow
  const state = new WeakMap();                         // swiper -> { mine: bool, hits: [times], gaveUp: bool }
  const seen = new Set();                              // swipers we've hooked (to resume them when leaving a product page)

  const onProductPage = () => PRODUCT_RE.test(location.pathname);
  const wantPaused = () => onProductPage() && ROOT.getAttribute("data-utl-slides") === "paused";
  const autoplays = (s) => {
    const p = s && s.params && s.params.autoplay;
    return !!(s && s.autoplay && p && (p === true || p.enabled));
  };
  const canPause = (s) => typeof s.autoplay.pause === "function" && typeof s.autoplay.resume === "function";
  const isPaused = (s) => (canPause(s) ? !!s.autoplay.paused || !s.autoplay.running : !s.autoplay.running);

  function pause(s, st) {
    st.mine = true;
    try { if (canPause(s)) s.autoplay.pause(); else s.autoplay.stop(); } catch (_) {}
  }
  function resume(s, st) {
    if (!st.mine) return; // only undo what we did
    st.mine = false;
    try { if (canPause(s)) { if (s.autoplay.running) s.autoplay.resume(); else s.autoplay.start(); } else s.autoplay.start(); } catch (_) {}
  }

  function enforce(s) {
    if (!s || s.destroyed || !s.autoplay) { seen.delete(s); return; }
    const st = state.get(s);
    if (wantPaused()) { if (!st.gaveUp && !isPaused(s)) pause(s, st); }
    else resume(s, st);
  }

  // Something resumed a slideshow we paused: pause it again, but give up if it keeps happening
  function resumedBySomeone(s) {
    const st = state.get(s);
    if (!st || !wantPaused() || st.gaveUp) return;
    const now = Date.now();
    st.hits = st.hits.filter((t) => now - t < WINDOW_MS);
    st.hits.push(now);
    if (st.hits.length > MAX_REPAUSES) {
      st.gaveUp = true; st.mine = false;
      const el = s.el; if (el) el.setAttribute("data-utl-autoplay", "stubborn"); // the extension shows it can't pause this one
      return;
    }
    setTimeout(() => { if (wantPaused() && !isPaused(s)) pause(s, st); }, 0);
  }

  function hook(el) {
    const s = el.swiper;
    if (!s || s.destroyed || !autoplays(s)) return;
    if (!state.has(s)) {
      state.set(s, { mine: false, hits: [], gaveUp: false });
      seen.add(s);
      try { s.on("autoplayResume", () => resumedBySomeone(s)); s.on("autoplayStart", () => resumedBySomeone(s)); } catch (_) {}
    }
    const st = state.get(s);
    const tag = st.gaveUp ? "stubborn" : "1";
    if (el.getAttribute("data-utl-autoplay") !== tag) el.setAttribute("data-utl-autoplay", tag);
    enforce(s);
  }

  let wasProduct = false;
  function tick() {
    const product = onProductPage();
    if (product) document.querySelectorAll(".swiper-initialized, .swiper-container-initialized").forEach(hook);
    else if (wasProduct) { // left a product page (the store moves between pages without reloading)
      seen.forEach((s) => enforce(s));
      document.querySelectorAll("[data-utl-autoplay]").forEach((e) => e.removeAttribute("data-utl-autoplay"));
    }
    wasProduct = product;
  }

  // A light check once a second (no page-wide change watching), plus an instant reaction to the setting
  new MutationObserver(() => seen.forEach((s) => enforce(s))).observe(ROOT, { attributes: true, attributeFilter: ["data-utl-slides"] });
  setInterval(tick, 1000);
  tick();
})();
