// RSI Utilify: slideshow control, page side.
// This small script runs in the page's own context (not the extension's), because the site's image
// slideshows are Swiper carousels and their autoplay can only be reached through the Swiper object the
// page created. It does two things:
//  1. tags every slideshow that plays by itself with data-utl-autoplay="1" (so the extension can add its
//     pause button to it), and
//  2. pauses or resumes those slideshows when <html data-utl-slides="paused|playing"> changes.
// It never starts a slideshow that wasn't auto-playing to begin with, and it sends nothing anywhere.
(() => {
  "use strict";
  if (window.__utilifySlides) return;
  window.__utilifySlides = true;

  const ROOT = document.documentElement;
  const known = new WeakSet();   // Swiper instances we've hooked
  const stopped = new WeakSet(); // Swiper instances we paused (only these are ever restarted)
  let scanQueued = false;

  const wantPaused = () => ROOT.getAttribute("data-utl-slides") === "paused";
  const autoplays = (s) => {
    const p = s && s.params && s.params.autoplay;
    return !!(s && s.autoplay && p && (p === true || p.enabled));
  };

  function enforce(s) {
    if (!s || s.destroyed || !s.autoplay) return;
    if (wantPaused()) {
      if (s.autoplay.running) { stopped.add(s); try { s.autoplay.stop(); } catch (_) {} }
    } else if (stopped.has(s)) {
      stopped.delete(s);
      try { s.autoplay.start(); } catch (_) {}
    }
  }

  function hook(el) {
    const s = el.swiper;
    if (!s || s.destroyed || !autoplays(s)) return;
    if (el.getAttribute("data-utl-autoplay") !== "1") el.setAttribute("data-utl-autoplay", "1");
    if (!known.has(s)) {
      known.add(s);
      // If the site (or a click on a thumbnail) starts autoplay again while paused, stop it again
      const again = () => { if (wantPaused()) enforce(s); };
      try { s.on("autoplayStart", again); s.on("autoplayResume", again); s.on("slideChangeTransitionEnd", again); } catch (_) {}
    }
    enforce(s);
  }

  function scan() {
    scanQueued = false;
    document.querySelectorAll(".swiper, .swiper-container, .swiper-initialized").forEach(hook);
  }
  const queueScan = () => { if (!scanQueued) { scanQueued = true; setTimeout(scan, 120); } };

  // Slideshows are created after the page loads (and re-created as you browse), so keep looking
  new MutationObserver(queueScan).observe(ROOT, { childList: true, subtree: true });
  new MutationObserver(scan).observe(ROOT, { attributes: true, attributeFilter: ["data-utl-slides"] });
  scan();
  setTimeout(scan, 1000); setTimeout(scan, 3000);
})();
