// Tracks what's been changed since the save was opened and since the last
// download (for the change count, highlighting in the tree and raw views, and
// the review before download), and the Compare tab.
"use strict";

const Changes = (() => {
  let originalDoc = null, list = [], nodes = new Set(), containers = new Set(), timer = null;
  // Snapshot taken at the last download, and what's been edited since.
  let downloadedDoc = null, downloadedFrom = null, touchedSinceDownload = null, sinceDownload = [];
  const listeners = [];

  // Diffing a whole save takes a while, so we watch which elements get edited.
  // Anything outside those branches is still identical to the original. A
  // document swapped in from the raw editor has no record and is diffed fully.
  const touchedByDoc = new WeakMap();
  let observer = null, watchedDoc = null;
  function watch(doc) {
    if (observer) observer.disconnect();
    watchedDoc = doc;
    if (!doc) return;
    if (!touchedByDoc.has(doc)) touchedByDoc.set(doc, doc === loadedDoc ? new Set() : null);
    observer = new MutationObserver(records => markTouched(doc, records));
    observer.observe(doc, { subtree: true, childList: true, characterData: true, attributes: true });
  }
  let loadedDoc = null;
  function addBranch(set, records) {
    for (const r of records) {
      for (let n = r.target.nodeType === 1 ? r.target : r.target.parentNode; n && n.nodeType === 1 && !set.has(n); n = n.parentNode) set.add(n);
    }
  }
  function markTouched(doc, records) {
    const touched = touchedByDoc.get(doc);
    if (touched) addBranch(touched, records);
    if (touchedSinceDownload && doc === downloadedFrom) addBranch(touchedSinceDownload, records);
  }

  function original() {
    if (!originalDoc && App.save) {
      originalDoc = new DOMParser().parseFromString(new TextDecoder().decode(App.save.originalXmlBytes), "application/xml");
    }
    return originalDoc;
  }

  function reset() {
    clearTimeout(timer);
    originalDoc = null; list = []; nodes = new Set(); containers = new Set();
    downloadedDoc = downloadedFrom = touchedSinceDownload = null; sinceDownload = [];
    loadedDoc = App.save ? App.save.doc : null;
    watch(loadedDoc);
    emit();
  }

  function compute() {
    clearTimeout(timer);
    if (!App.save) return reset();
    if (watchedDoc !== App.save.doc) watch(App.save.doc);
    if (observer) markTouched(App.save.doc, observer.takeRecords());
    const touched = touchedByDoc.get(App.save.doc);
    list = Model.diff(original(), App.save.doc, touched ? { unchanged: n => !touched.has(n) } : {});
    if (downloadedDoc) {
      const quick = touchedSinceDownload && downloadedFrom === App.save.doc ? { unchanged: n => !touchedSinceDownload.has(n) } : {};
      sinceDownload = Model.diff(downloadedDoc, App.save.doc, quick);
    }
    nodes = new Set(); containers = new Set();
    for (const c of list) {
      const n = Model.changeNode(App.save.doc, c);
      if (!n) continue;
      if (c.kind === "removed" && !c.csv) containers.add(n); else nodes.add(n);
      for (let p = n.parentNode; p && p.nodeType === 1; p = p.parentNode) containers.add(p);
    }
    emit();
    return list;
  }

  // snapshot is a copy of the document as it was written to the download.
  // upToDate is false if edits may have happened since the copy was taken,
  // in which case the next comparison checks everything.
  function markDownloaded(snapshot = App.save.doc.cloneNode(true), from = App.save.doc, upToDate = true) {
    downloadedDoc = snapshot;
    downloadedFrom = from;
    touchedSinceDownload = upToDate ? new Set() : null;
    sinceDownload = [];
    compute();
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(compute, 350); }
  App.onChange(() => {
    if (App.save && watchedDoc !== App.save.doc) {
      if (observer && watchedDoc) markTouched(watchedDoc, observer.takeRecords());
      watch(App.save.doc);
    }
    schedule();
  });

  function emit() { for (const fn of listeners) fn(list); }

  // Shared list rendering
  const KIND = { changed: ["✎", "Changed"], added: ["+", "Added"], removed: ["−", "Removed"] };
  function changeLine(c, opts = {}) {
    const [icon, word] = KIND[c.kind];
    // Readable names where the value is a code; the raw value goes in the tooltip.
    const show = (label, raw) => (label ? [{ title: raw }, label] : [raw]);
    const value = c.csv ? null
      : c.kind === "changed" ? el("span.vals", el("del", ...show(c.beforeLabel, c.before)), " → ", el("ins", ...show(c.afterLabel, c.after)))
      : el("span.vals", c.kind === "added" ? el("ins", c.after) : el("del", c.before));
    return el(opts.checkbox ? "label.change" : "div.change", { class: "k-" + c.kind },
      opts.checkbox || null,
      el("span.kind", { title: word }, icon),
      el("span.what", c.csv ? { title: c.csv } : {}, shortLabel(c)), value);
  }
  // Inside a group headed "Squad", "Squad › Devlin › XP" reads as "Devlin › XP".
  function shortLabel(c) {
    const label = c.label || Model.sectionOf(c);
    const prefix = Model.sectionOf(c) + " › ";
    return label.startsWith(prefix) ? label.slice(prefix.length) : label;
  }

  function grouped(changes, render) {
    const groups = new Map();
    for (const c of changes) {
      const g = Model.sectionOf(c);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(c);
    }
    return [...groups].map(([name, items]) => render(name, items));
  }

  // Review before download
  function changeListView(changes, since) {
    const plural = n => `${n} change${n === 1 ? "" : "s"}`;
    if (!changes.length) return el("p", since === "download" ? "Nothing has changed since your last download." : "Nothing has changed, so the download will be the same save.");
    const wrap = el("div");
    const draw = max => {
      const more = changes.length - max;
      const showRest = el("p", el("button.btn.small", { type: "button", onclick: () => draw(Infinity) }, `Show the other ${more}`));
      wrap.replaceChildren(
        el("p", `${plural(changes.length)} since ${since === "download" ? "your last download" : "you opened " + App.file.name}:`),
        el("div.change-list", grouped(changes.slice(0, max), (name, items) => el("div.change-group", el("h4", name), items.map(c => changeLine(c))))),
        ...(more > 0 ? [showRest] : []));
    };
    draw(400);
    return wrap;
  }

  function review(actions) {
    compute();
    if (!downloadedDoc) { modal("Review changes", changeListView(list, "open"), actions); return; }
    const body = el("div");
    const tabs = el("div.subtabs");
    const show = which => {
      for (const b of tabs.children) b.classList.toggle("active", b.dataset.which === which);
      body.replaceChildren(tabs, which === "download" ? changeListView(sinceDownload, "download") : changeListView(list, "open"));
    };
    tabs.append(
      el("button", { type: "button", dataset: { which: "download" }, onclick: () => show("download") }, `Since last download (${sinceDownload.length})`),
      el("button", { type: "button", dataset: { which: "open" }, onclick: () => show("open") }, `Since opening the file (${list.length})`));
    show("download");
    modal("Review changes", body, actions);
  }

  return {
    compute, reset, review, original, markDownloaded, changeLine, grouped,
    onUpdate: fn => listeners.push(fn),
    list: () => list,
    count: () => list.length,
    countSinceDownload: () => (downloadedDoc ? sinceDownload.length : null),
    isChanged: n => nodes.has(n),
    hasChangesInside: n => containers.has(n),
  };
})();

// Compare two saves
const CompareView = (() => {
  const NOISE = new Set(["fow", "position", "rotation", "rotationY", "playerLocation", "saveTime", "gameplaytime", "time",
    "objectiveTimestamps", "addendumTimestamps", "cameraZoom", "selectedPc", "markedread", "midmap", "x", "y", "z"]);
  const PER_PAGE = 100;
  let root, before = null, after = null, result = null, selected = new Set(), hideNoise = true, filter = "", page = 0;

  const isNoise = c => c.path.some(s => NOISE.has(s.tag));
  const matchesFilter = c => !filter || (c.label || "").toLowerCase().includes(filter);
  const visible = () => result.filter(c => (!hideNoise || !isNoise(c)) && matchesFilter(c));
  const changes = n => `${n} change${n === 1 ? "" : "s"}`;

  function changeGroups(list, renderGroup = (name, items) => el("div.change-group", el("h4", name), items.map(c => Changes.changeLine(c)))) {
    return el("div.change-list", Changes.grouped(list, renderGroup));
  }

  function render(container) {
    root = container || root;
    const slot = (label, get, set) => {
      const input = el("input", { type: "file", accept: ".xml", hidden: true });
      input.onchange = async () => {
        const file = input.files[0];
        input.value = "";
        if (!file) return;
        try { set({ name: file.name, doc: SaveFile.read(await file.arrayBuffer()).doc }); }
        catch (e) { banner(e.message); return; }
        result = null;
        render();
      };
      const useOpenSave = () => {
        set({ name: App.file.name + " (as it is now)", doc: App.save.doc.cloneNode(true), fromOpenSave: true });
        result = null;
        render();
      };
      const current = get();
      return el("div.compare-slot",
        el("span.label", label),
        el("strong", current ? current.name : "Not chosen"),
        el("div.row-actions",
          el("button.btn", { type: "button", onclick: () => input.click() }, "Choose save…"),
          el("button.btn", { type: "button", disabled: !App.save, onclick: useOpenSave }, "Use the open save")),
        input);
    };
    const intro = el("section.card",
      el("h3", "Compare two saves"),
      el("p", "Pick a save from before something happened in game and one from after to see what changed. You can then copy those changes into the open save."),
      caution("Copying story changes can leave quests in a state the game doesn't expect.", "Copy only what you need."),
      el("div.compare-slots",
        slot("Before", () => before, v => (before = v)),
        slot("After", () => after, v => (after = v))),
      el("div.row-actions", el("button.btn.primary", { type: "button", disabled: !(before && after), onclick: run }, "Compare")));
    root.replaceChildren(intro, result ? renderResult() : el("div"));
  }

  function run() {
    result = Model.diff(before.doc, after.doc);
    selected = new Set();
    page = 0;
    render();
  }

  function renderResult() {
    const noiseCount = result.filter(isNoise).length;
    const search = el("input", { type: "search", placeholder: "Filter changes…", value: filter });
    search.oninput = () => { filter = search.value.toLowerCase(); page = 0; redraw(); };
    const toggleNoise = e => { hideNoise = e.target.checked; page = 0; render(); };
    const noise = el("label.inline",
      el("input", { type: "checkbox", checked: hideNoise, onchange: toggleNoise }),
      ` Hide map and timing details (${noiseCount})`);
    const counter = el("span.muted");
    const updateCounter = () => { counter.textContent = `${selected.size} of ${result.length} selected`; };
    const select = (c, on) => (on ? selected.add(c) : selected.delete(c));
    const listWrap = el("div");

    const group = (name, items) => {
      const groupBox = el("input", { type: "checkbox", checked: items.every(c => selected.has(c)) });
      groupBox.onchange = () => { for (const c of items) select(c, groupBox.checked); redraw(); };
      return el("div.change-group",
        el("h4", el("label.inline", groupBox, " " + name)),
        items.map(c => {
          const box = el("input", { type: "checkbox", checked: selected.has(c) });
          box.onchange = () => { select(c, box.checked); updateCounter(); };
          return Changes.changeLine(c, { checkbox: box });
        }));
    };
    function redraw() {
      const shown = visible();
      page = Math.min(page, lastPage(shown.length, PER_PAGE));
      const nav = () => pager(shown.length, page, PER_PAGE, n => { page = n; redraw(); });
      listWrap.replaceChildren(...[nav(), changeGroups(pageItems(shown, page, PER_PAGE), group), nav()].filter(Boolean));
      updateCounter();
    }
    redraw();

    const selectShown = () => { for (const c of visible()) selected.add(c); redraw(); };
    const clear = () => { selected.clear(); redraw(); };
    const title = `${result.length} difference${result.length === 1 ? "" : "s"}`;
    if (!result.length) return el("section.card", el("h3", title), el("p.muted", "These saves are the same."));
    return el("section.card",
      el("h3", title),
      el("p.hint", "Only ticked changes are copied, including ones hidden by the filter."),
      el("div.filters", search, noise),
      el("div.row-actions",
        counter,
        el("button.btn", { type: "button", onclick: selectShown }, "Select all shown"),
        el("button.btn", { type: "button", onclick: clear }, "Clear selection"),
        el("button.btn.primary", { type: "button", disabled: !App.save, title: App.save ? "" : "Open a save first", onclick: confirmCopy },
          "Copy selected changes into the open save…")),
      listWrap);
  }

  function confirmCopy() {
    if (!App.save) return toast("Open a save first");
    const chosen = result.filter(c => selected.has(c));
    if (!chosen.length) return toast("Nothing selected");
    const shown = new Set(visible());
    const hidden = chosen.filter(c => !shown.has(c)).length;
    modal("Copy " + changes(chosen.length), el("div",
      el("p", `These will be copied into ${App.file.name}:`),
      hidden ? el("p.notice.warn-box", `${hidden} of them are hidden by the filter.`) : null,
      changeGroups(chosen)),
    [{ label: "Copy", primary: true, onClick: () => applySelected(chosen) }, { label: "Cancel", onClick: () => {} }]);
  }

  function applySelected(chosen, force = false) {
    const r = Model.applyChanges(App.save.doc, chosen, { force });
    if (r.applied) App.changed("compare");
    if (!r.failed.length && !r.conflicts.length) {
      toast(`Copied ${changes(r.applied)} into ${App.file.name}`, { undo: true });
      return;
    }

    const conflictLine = ({ change, current }) => el("div.change",
      el("span.what", change.label),
      el("span.vals", "before ", el("del", change.before), ", after ", el("ins", change.after), ", open save has ", el("strong", current)));
    const failureLine = ({ change, reason }) => el("div.change", el("span.what", change.label), el("span.vals", reason));
    const body = el("div",
      el("p", r.applied ? `Copied ${changes(r.applied)}. Undo puts them all back.` : "Nothing was copied."),
      r.conflicts.length ? el("div",
        el("h4", `${changes(r.conflicts.length)} skipped because the open save has a different value now`),
        el("div.change-list", r.conflicts.map(conflictLine))) : null,
      r.failed.length ? el("div",
        el("h4", `${changes(r.failed.length)} couldn't be copied`),
        el("div.change-list", r.failed.map(failureLine))) : null);

    const actions = [];
    if (r.conflicts.length) actions.push({ label: "Copy the skipped ones anyway", onClick: () => applySelected(r.conflicts.map(x => x.change), true) });
    if (r.applied) actions.push({ label: "Undo the copy", onClick: () => App.undo() });
    actions.push({ label: "OK", primary: true, onClick: () => {} });
    modal("Copy finished with problems", body, actions);
  }

  // A newly opened save replaces any slot that was taken from the previous one.
  function reset() {
    if (before && before.fromOpenSave) before = null;
    if (after && after.fromOpenSave) after = null;
    result = null;
  }

  return { render, reset };
})();
