// App shell: loading, tabs and views, undo/redo, downloading.
"use strict";

const Main = (() => {
  const VIEW_KEY = "wl3-editor-view";
  const views = { simple: SimpleEditor, tree: TreeView, raw: RawEditor };
  const stale = { simple: true, tree: true, raw: true, compare: true };
  let tab = null;
  let view = "simple";
  try { view = localStorage.getItem(VIEW_KEY) || "simple"; } catch {}
  if (!views[view]) view = "simple";

  const $ = id => document.getElementById(id);

  App.onChange(src => {
    for (const k in stale) if (k !== src) stale[k] = true;
    if (tab === "edit" && (src !== view || src === "history")) renderView();
  });

  // Tabs
  function leaveRaw() {
    if (tab === "edit" && view === "raw" && !RawEditor.apply()) {
      banner('Your raw XML edits have an error. Fix them or click "Discard edits" first.');
      return false;
    }
    return true;
  }

  function showTab(name) {
    if (name !== tab && !leaveRaw()) return;
    banner(null);
    tab = name;
    for (const b of document.querySelectorAll("#tabs [data-tab]")) {
      b.classList.toggle("active", b.dataset.tab === name);
      b.setAttribute("aria-selected", String(b.dataset.tab === name));
    }
    for (const k of ["edit", "compare", "codes", "help"]) $("tab-" + k).hidden = k !== name;
    if (name === "edit") renderView();
    if (name === "compare") { CompareView.render($("tab-compare")); stale.compare = false; }
    if (name === "codes") CodesView.render($("tab-codes"));
  }

  function setView(v) {
    if (v === view) return;
    if (!leaveRaw()) { $("viewSelect").value = view; return; }
    view = v;
    try { localStorage.setItem(VIEW_KEY, v); } catch {}
    renderView();
  }

  function renderView() {
    $("viewSelect").value = view;
    $("dropzone").hidden = !!App.save;
    $("viewBar").hidden = !App.save;
    for (const k of Object.keys(views)) $("view-" + k).hidden = !App.save || k !== view;
    if (!App.save) return;
    if (stale[view]) { views[view].render($("view-" + view)); stale[view] = false; }
    else if (view === "raw") RawEditor.render();
  }

  function inEditor(go) {
    if (tab !== "edit") showTab("edit");
    if (view !== "simple") setView("simple");
    go();
    stale.simple = false;
  }
  const goEditor = target => inEditor(() => SimpleEditor.goto(target));
  const goCollectible = code => inEditor(() => SimpleEditor.showCollectible(code));

  // Loading
  async function loadFile(file) {
    if (!file) return;
    if (hasUnsaved() && !window.confirm("You have changes you haven't downloaded. Open a different save anyway?")) return;
    banner(null);
    try {
      const buffer = await file.arrayBuffer();
      const save = SaveFile.read(buffer);
      // Kept for the backup in the zip: the file on disk may have been
      // replaced by then (often with the edited save itself).
      save.fileBytes = new Uint8Array(buffer);
      App.save = save;
      App.file = file;
      App.dirty = false;
      $("nextStep").hidden = true;
      SimpleEditor.reset();
      RawEditor.reset();
      CompareView.reset();
      Changes.reset();
      History.attach(save.doc);
      for (const k in stale) stale[k] = true;
      $("fileName").textContent = file.name;
      $("fileInfo").hidden = false;
      $("downloadGroup").hidden = false;
      $("historyGroup").hidden = false;
      updateCount();
      showTab("edit");
      renderView();
      toast("Opened " + file.name);
    } catch (e) {
      console.error(e);
      banner(e.message || String(e));
    }
  }

  // Downloading
  function build() {
    if (!leaveRaw()) return null;
    try {
      return SaveFile.write(App.save).bytes;
    } catch (e) {
      console.error(e);
      banner("Couldn't build the save: " + e.message);
      return null;
    }
  }

  function download() {
    const bytes = build();
    if (!bytes) return;
    saveBlob(new Blob([bytes], { type: "application/octet-stream" }), App.file.name);
    markSaved(snapshot(), { zip: false });
  }

  async function downloadZip() {
    const bytes = build();
    if (!bytes) return;
    if (!window.JSZip) return banner('The zip library didn\'t load. Use "Download save" instead.');
    // Captured before the await: later edits, or another save opened in the
    // meantime, mustn't be marked as downloaded.
    const snap = snapshot(), save = App.save, file = App.file;
    try {
      const zip = new JSZip();
      zip.file(file.name, bytes);
      zip.file("backup/" + file.name, save.fileBytes);
      saveBlob(await zip.generateAsync({ type: "blob" }), file.name.replace(/\.xml$/i, "") + ".zip");
    } catch (e) {
      console.error(e);
      banner(`Couldn't make the zip (${e.message}). Use "Download save" instead.`);
      return;
    }
    if (App.save !== save) { toast(`Downloaded ${file.name.replace(/\.xml$/i, "")}.zip`); return; }
    markSaved(snap, { zip: true });
  }

  // App.dirty is only a hint; the diff decides, so undoing everything counts as clean.
  function hasUnsaved() {
    if (!App.save) return false;
    if (RawEditor.hasPending()) return true;
    if (!App.dirty) return false;
    Changes.compute();
    const since = Changes.countSinceDownload();
    return (since === null ? Changes.count() : since) > 0;
  }

  function snapshot() { return { doc: App.save.doc.cloneNode(true), from: App.save.doc, revision: App.revision }; }

  function startDownload(zip) {
    if (!leaveRaw()) return;
    Changes.review([
      { label: zip ? "Download with backup (.zip)" : "Download save", primary: true, onClick: () => (zip ? downloadZip() : download()) },
      { label: "Cancel", onClick: () => {} },
    ]);
  }

  function markSaved(snap, { zip }) {
    const upToDate = App.revision === snap.revision;
    App.dirty = !upToDate;
    Changes.markDownloaded(snap.doc, snap.from, upToDate);
    showNextStep(zip);
  }

  function showNextStep(zip) {
    const name = App.file.name;
    const note = $("nextStep");
    const message = zip
      ? ["Downloaded. Unzip it and copy ", el("code", name), " (not the one in the backup folder) over the original in the save's folder, keeping the same name."]
      : ["Downloaded. Copy ", el("code", name), " over the original in the save's folder, keeping the same name."];
    const showSaveFolders = () => {
      showTab("help");
      $("where-saves").scrollIntoView({ block: "start" });
    };
    note.replaceChildren(
      el("span", ...message),
      el("button.link-btn", { type: "button", onclick: showSaveFolders }, "Where's that?"),
      el("button.icon", { type: "button", title: "Close", "aria-label": "Close", onclick: () => { note.hidden = true; } }, "✕"));
    note.hidden = false;
  }

  // Change count, undo/redo
  function updateCount() {
    const total = Changes.count();
    const recent = Changes.countSinceDownload();
    const badge = $("changeBadge");
    const n = recent === null ? total : recent;
    badge.hidden = !App.save || n === 0;
    badge.textContent = (n === 1 ? "1 change" : `${n} changes`) + (recent === null ? "" : " since download");
  }
  Changes.onUpdate(updateCount);
  History.onUpdate(({ canUndo, canRedo }) => { $("undoBtn").disabled = !canUndo; $("redoBtn").disabled = !canRedo; });

  function inTextField(e) {
    const t = e.target;
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest(".CodeMirror"));
  }
  addEventListener("keydown", e => {
    if (!App.save || !(e.ctrlKey || e.metaKey) || inTextField(e)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); App.undo(); }
    else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); App.redo(); }
  });

  // Applying raw edits after an undo would overwrite it, so ask first.
  function guardedHistory(step, what) {
    if (tab === "edit" && view === "raw" && RawEditor.hasPending()) {
      modal("Unapplied raw XML edits", el("p", `Your raw XML edits haven't been applied. Apply or discard them before you ${what}.`), [
        { label: "Keep editing", primary: true, onClick: () => {} },
        { label: "Apply them", onClick: () => { if (RawEditor.apply()) toast("Applied your raw XML edits."); } },
        { label: `Throw them away and ${what}`, onClick: () => { RawEditor.discard(); step(); } },
      ]);
      return false;
    }
    return step();
  }
  App.undo = () => guardedHistory(() => History.undo(), "undo");
  App.redo = () => guardedHistory(() => History.redo(), "redo");

  // Where saves are kept. Sources: inXile support and PCGamingWiki.
  const SAVE_PATHS = [
    { id: "windows", label: "Windows", path: "%USERPROFILE%\\Documents\\My Games\\Wasteland3\\Save Games\\",
      help: "Paste it into the address bar of the file picker. If your Documents folder is in OneDrive, it'll be under OneDrive instead." },
    { id: "mac", label: "Mac", path: "~/Library/Application Support/Wasteland3/Save Games/",
      help: "In the file picker, press Cmd+Shift+G and paste it in." },
    { id: "linux", label: "Linux / Steam Deck", path: "~/.config/Wasteland3/Save Games/",
      help: "In most file pickers, press Ctrl+L and paste it in. If you've set XDG_CONFIG_HOME, it's under that instead of ~/.config." },
    { id: "proton", label: "Windows version through Proton", path: "~/.steam/steam/steamapps/compatdata/719040/pfx/drive_c/users/steamuser/Documents/My Games/Wasteland3/Save Games/",
      help: "Only if you've forced Steam to run the Windows version. The start of the path depends on where Steam is installed." },
    { id: "gamepass", label: "Game Pass", path: "%LOCALAPPDATA%\\Packages\\DeepSilver.56575194F7E04_hmv7qcest37me\\SystemAppData\\wgs\\",
      help: "Game Pass saves are stored differently and haven't been tried with this editor." },
  ];
  function guessPlatform() {
    const ua = navigator.userAgent;
    if (/Mac/.test(ua)) return "mac";
    if (/Linux|X11|CrOS/.test(ua) && !/Android/.test(ua)) return "linux";
    return "windows";
  }
  function renderSavePaths(box) {
    let current = guessPlatform();
    const platformButton = p => el("button", {
      type: "button", role: "tab", class: p.id === current ? "active" : "", "aria-selected": String(p.id === current),
      onclick: () => { current = p.id; draw(); },
    }, p.label);
    const draw = () => {
      const p = SAVE_PATHS.find(x => x.id === current);
      box.replaceChildren(
        el("div.platforms", { role: "tablist" }, SAVE_PATHS.map(platformButton)),
        el("div.path-box", el("code", p.path), el("button.btn.small", { type: "button", onclick: () => copyText(p.path) }, "Copy")),
        el("p.muted", p.help + " If the folder isn't there, search your computer for one called Wasteland3."));
    };
    draw();
  }

  // Wiring
  const input = $("fileInput");
  input.addEventListener("change", () => { loadFile(input.files[0]); input.value = ""; });
  $("downloadBtn").addEventListener("click", () => startDownload(false));
  $("downloadZipBtn").addEventListener("click", () => startDownload(true));
  $("changeBadge").addEventListener("click", () => Changes.review([{ label: "Close", primary: true, onClick: () => {} }]));
  $("undoBtn").addEventListener("click", () => App.undo());
  $("redoBtn").addEventListener("click", () => App.redo());
  $("searchBtn").addEventListener("click", () => QuickSearch.open());
  $("openBtn").addEventListener("click", () => input.click());
  $("viewSelect").addEventListener("change", e => setView(e.target.value));
  for (const b of document.querySelectorAll("#tabs [data-tab]")) b.addEventListener("click", () => showTab(b.dataset.tab));
  for (const box of document.querySelectorAll("[data-save-paths]")) renderSavePaths(box);

  addEventListener("dragover", e => { e.preventDefault(); document.body.classList.add("dragging"); });
  addEventListener("dragleave", e => { if (!e.relatedTarget) document.body.classList.remove("dragging"); });
  addEventListener("drop", e => {
    e.preventDefault();
    if (document.querySelector(".overlay")) return;
    document.body.classList.remove("dragging");
    const item = e.dataTransfer.items && e.dataTransfer.items[0];
    const entry = item && item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry && entry.isDirectory) {
      banner(`That's a folder. Open "${entry.name}" and drag the .xml file inside it instead.`);
      return;
    }
    loadFile(e.dataTransfer.files[0]);
  });
  addEventListener("beforeunload", e => { if (hasUnsaved()) { e.preventDefault(); e.returnValue = ""; } });

  showTab("edit");

  return { showTab, goEditor, goCollectible, setView, leaveRaw };
})();
