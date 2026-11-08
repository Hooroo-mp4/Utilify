const $ = (id) => document.getElementById(id);

// A tiny, safe markdown renderer for GitHub release notes: headings, bullets, **bold**, `code`, [links](https://...).
// Everything is built with textContent/DOM nodes, never innerHTML.
function inline(parent, text) {
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    const t = m[0];
    if (t.startsWith("**")) { const e = document.createElement("strong"); e.textContent = t.slice(2, -2); parent.appendChild(e); }
    else if (t.startsWith("`")) { const e = document.createElement("code"); e.textContent = t.slice(1, -1); parent.appendChild(e); }
    else {
      const [, label, url] = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(t);
      const e = document.createElement("a"); e.textContent = label; e.href = url; e.target = "_blank"; e.rel = "noopener noreferrer"; parent.appendChild(e);
    }
    last = m.index + t.length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function renderNotes(container, md) {
  container.textContent = "";
  let list = null;
  const lines = (md || "").replace(/\r/g, "").split("\n");
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { list = null; continue; }
    let m;
    if ((m = /^#{1,6}\s+(.*)$/.exec(line))) { list = null; const h = document.createElement("h3"); inline(h, m[1]); container.appendChild(h); }
    else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      if (!list) { list = document.createElement("ul"); container.appendChild(list); }
      const li = document.createElement("li"); inline(li, m[1]); list.appendChild(li);
    } else if ((m = /^>\s?(.*)$/.exec(line))) { list = null; const p = document.createElement("p"); inline(p, m[1]); container.appendChild(p); }
    else { list = null; const p = document.createElement("p"); inline(p, line.trim()); container.appendChild(p); }
  }
  if (!container.childNodes.length) container.textContent = "No release notes were provided for this version.";
}

(async function () {
  const { updateInfo: u } = await chrome.storage.local.get("updateInfo");
  if (!u) { $("title").textContent = "No update details found"; $("versions").textContent = "Open the extension menu and press “Check now”."; return; }
  $("title").textContent = "RSI Utilify " + u.version + " is available";
  $("versions").textContent = "";
  $("versions").append("You have ", Object.assign(document.createElement("strong"), { textContent: u.current }), " · latest is ", Object.assign(document.createElement("strong"), { textContent: u.version }));
  if (u.published) $("date").textContent = "Released " + new Date(u.published).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });
  renderNotes($("notes"), u.notes);
  const zip = (u.assets || []).find((a) => /^Utilify\.zip$/i.test(a.name)) || (u.assets || []).find((a) => /\.zip$/i.test(a.name));
  $("download").href = zip ? zip.url : (u.zipball || u.url);
  $("download").textContent = zip ? "Download " + zip.name : "Download";
  $("release").href = u.url;
  $("skip").addEventListener("click", async () => {
    await chrome.storage.local.set({ updateSkipped: u.version });
    $("skip").disabled = true; $("skipNote").textContent = "Okay, you won't be reminded about " + u.version + " again. A newer release will still show up.";
  });
})();
