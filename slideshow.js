// RSI Utilify: slideshow control, extension side.
// Adds a small pause / play button to product image slideshows that slide by themselves and remembers
// the choice (setting "slideshowPaused"), so every RSI tab and page follows it. The actual pausing is
// done by slideshow-main.js, which runs in the page's context; the two talk through
// <html data-utl-slides="paused|playing"> and data-utl-autoplay="1" on each auto-playing slideshow.
(() => {
  "use strict";
  const ROOT = document.documentElement;
  const BTN = "utl-slide-btn";
  let paused = false;
  let queued = false;

  const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';

  function render(btn) {
    btn.innerHTML = (paused ? ICON_PLAY : ICON_PAUSE) + "<span>" + (paused ? "Play" : "Pause") + "</span>";
    btn.setAttribute("aria-pressed", String(paused));
    btn.setAttribute("aria-label", paused ? "Play slideshow (RSI Utilify)" : "Pause slideshow (RSI Utilify)");
    btn.title = paused ? "Slideshow paused by RSI Utilify. Click to play." : "Pause this slideshow (RSI Utilify)";
    btn.classList.toggle("-paused", paused);
  }

  function apply() {
    ROOT.setAttribute("data-utl-slides", paused ? "paused" : "playing");
    document.querySelectorAll("." + BTN).forEach(render);
  }

  function addButtons() {
    queued = false;
    document.querySelectorAll('[data-utl-autoplay="1"]').forEach((sw) => {
      const host = sw.closest(".orion-c-slideShow") || sw.parentElement || sw;
      if (host.querySelector(":scope > ." + BTN)) return;
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = BTN;
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
  const queue = () => { if (!queued) { queued = true; setTimeout(addButtons, 150); } };

  async function start() {
    try { paused = !!(await chrome.storage.local.get("slideshowPaused")).slideshowPaused; } catch (_) {}
    apply();
    addButtons();
    new MutationObserver(queue).observe(ROOT, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-utl-autoplay"] });
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.slideshowPaused) { paused = !!changes.slideshowPaused.newValue; apply(); }
      });
    } catch (_) {}
  }
  start();
})();
