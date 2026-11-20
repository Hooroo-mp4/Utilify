// RSI Utilify: slideshow control, extension side.
// On product pages (/pledge/<something>, not the /pledge store front) adds a small Pause / Play button to
// image slideshows that slide by themselves, and remembers the choice (setting "slideshowPaused") so every
// RSI tab follows it. The pausing itself is done by slideshow-main.js in the page's context; the two talk
// through <html data-utl-slides="paused|playing"> and data-utl-autoplay on each auto-playing slideshow.
(() => {
  "use strict";
  const ROOT = document.documentElement;
  const BTN = "utl-slide-btn";
  const PRODUCT_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?pledge\/[^/]+/i;
  let paused = false;

  const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';

  function render(btn) {
    const stubborn = btn._sw && btn._sw.getAttribute("data-utl-autoplay") === "stubborn";
    const key = (paused ? "p" : "r") + (stubborn ? "s" : "");
    if (btn._key === key) return; // nothing changed: don't touch the page
    btn._key = key;
    btn.innerHTML = (paused ? ICON_PLAY : ICON_PAUSE) + "<span>" + (paused ? "Play" : "Pause") + "</span>";
    btn.setAttribute("aria-pressed", String(paused));
    btn.setAttribute("aria-label", paused ? "Play slideshow (RSI Utilify)" : "Pause slideshow (RSI Utilify)");
    btn.title = stubborn && paused ? "This slideshow keeps restarting itself, so RSI Utilify can't pause it."
      : paused ? "Slideshow paused by RSI Utilify. Click to play." : "Pause this slideshow (RSI Utilify)";
    btn.classList.toggle("-paused", paused);
  }

  function apply() {
    const v = paused ? "paused" : "playing";
    if (ROOT.getAttribute("data-utl-slides") !== v) ROOT.setAttribute("data-utl-slides", v);
    document.querySelectorAll("." + BTN).forEach(render);
  }

  function tick() {
    if (!PRODUCT_RE.test(location.pathname)) { // not a product page: no buttons (the store front keeps cycling)
      document.querySelectorAll("." + BTN).forEach((b) => b.remove());
      return;
    }
    document.querySelectorAll("." + BTN).forEach((b) => { if (!b._sw || !b._sw.isConnected || !b._sw.hasAttribute("data-utl-autoplay")) b.remove(); else render(b); });
    document.querySelectorAll("[data-utl-autoplay]").forEach((sw) => {
      const host = sw.closest(".orion-c-slideShow") || sw.parentElement || sw;
      if (host.querySelector(":scope > ." + BTN)) return;
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = BTN;
      btn._sw = sw;
      btn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation(); // don't let the click reach the slideshow
        paused = !paused;
        apply();
        try { chrome.storage.local.set({ slideshowPaused: paused }); } catch (_) {}
      });
      render(btn);
      host.appendChild(btn);
    });
  }

  async function start() {
    try { paused = !!(await chrome.storage.local.get("slideshowPaused")).slideshowPaused; } catch (_) {}
    apply();
    tick();
    setInterval(tick, 1000); // a light check once a second instead of watching every change on the page
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.slideshowPaused) { paused = !!changes.slideshowPaused.newValue; apply(); }
      });
    } catch (_) {}
  }
  start();
})();
