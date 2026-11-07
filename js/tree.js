// Tree view of the save XML. Rows are built only when expanded, so huge saves
// stay fast. Changed values and the branches containing them are highlighted.
"use strict";

const TreeView = (() => {
  const PAGE = 200;          // children rendered per "show more"
  const LONG = 160;          // values longer than this get a textarea on demand
  let root, treeEl, resultsEl, rows = new Map(), expanded = new Set(), lastDoc = null;

  Changes.onUpdate(() => { if (root && root.offsetParent) markChanges(); });

  function markChanges() {
    for (const [n, li] of rows) {
      li.classList.toggle("changed", Changes.isChanged(n));
      li.classList.toggle("has-changes", Changes.hasChangesInside(n));
    }
  }

  function isLeaf(n) { return !n.firstElementChild; }

  function siblingIndex(n) {
    let i = 0;
    for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.nodeName === n.nodeName) i++;
    let more = false;
    for (let s = n.nextElementSibling; s && !more; s = s.nextElementSibling) if (s.nodeName === n.nodeName) more = true;
    return i || more ? i : -1;
  }

  // Short label used in breadcrumbs and for list children (e.g. an item's templateName).
  function hintFor(n) {
    for (const tag of ["templateName", "displayName", "name", "perkname", "skillId", "pcName", "filename", "id"]) {
      const c = child(n, tag);
      if (c && c.textContent && isLeaf(c)) return c.textContent;
    }
    return "";
  }

  function pathOf(n) {
    const parts = [];
    for (let p = n; p && p.nodeType === 1; p = p.parentNode) {
      const i = siblingIndex(p);
      parts.unshift(p.nodeName + (i >= 0 ? `[${i}]` : ""));
    }
    return parts.join(" › ");
  }

  function render(container) {
    root = container || root;
    if (!App.save) { root.replaceChildren(); return; }
    const doc = App.save.doc;
    if (doc !== lastDoc) { expanded = new Set([doc.documentElement]); lastDoc = doc; }
    rows = new Map();

    const search = el("input", { type: "search", placeholder: "Search names or values, e.g. money, templateName, MedicPack… (Enter)" });
    search.onkeydown = e => { if (e.key === "Enter") runSearch(search.value.trim()); };
    const jump = el("span.change-nav",
      el("button.btn", { type: "button", title: "Previous change", onclick: () => nextChange(-1) }, "‹ Change"),
      el("button.btn", { type: "button", title: "Next change", onclick: () => nextChange(1) }, "Change ›"));
    resultsEl = el("div.results", { hidden: true });
    treeEl = el("ul.tree.root");
    treeEl.append(makeRow(doc.documentElement));

    const searchButton = el("button.btn", { type: "button", onclick: () => runSearch(search.value.trim()) }, "Search");
    root.replaceChildren(
      caution("No safety checks in this view.", "You can change or delete anything, including things the game needs. Use the ",
        jumpLink("Editor view", () => Main.setView("simple")), " where you can."),
      el("div.card.tree-tools", el("div.add-row", search, searchButton, jump), resultsEl),
      el("div.card.tree-card", treeEl));
    markChanges();
  }

  function makeRow(n) {
    const li = el("li", { class: (Changes.isChanged(n) ? "changed " : "") + (Changes.hasChangesInside(n) ? "has-changes" : "") });
    rows.set(n, li);
    const leaf = isLeaf(n);
    const head = el("div.node");
    if (leaf) {
      head.append(el("span.twisty"), el("span.tag", n.nodeName), valueEditor(n));
    } else {
      const count = n.childElementCount;
      const hint = hintFor(n);
      const tw = el("button.twisty", { type: "button", "aria-label": "Toggle" }, expanded.has(n) ? "▾" : "▸");
      tw.onclick = () => toggle(n);
      head.append(tw, el("span.tag", { onclick: () => toggle(n) }, n.nodeName));
      if (hint) head.append(el("span.hint-inline", hint));
      head.append(el("span.count", count + (count === 1 ? " child" : " children")));
    }
    for (const a of n.attributes) head.append(el("span.attr", `${a.name}="${a.value}"`));
    if (n.parentNode && n.parentNode.nodeType === 1) {
      head.append(el("span.actions",
        canDuplicate(n) ? el("button.icon", { type: "button", title: "Duplicate", onclick: () => duplicate(n) }, "⧉") : null,
        el("button.icon", { type: "button", title: "Delete", onclick: () => remove(n) }, "✕")));
    }
    li.append(head);
    if (!leaf && expanded.has(n)) li.append(renderChildren(n));
    return li;
  }

  function renderChildren(n, minCount = 0) {
    const ul = el("ul.tree");
    const kids = children(n);
    let shown = 0;
    const more = el("li.more");
    const showMore = upTo => {
      const end = Math.min(kids.length, Math.max(shown + PAGE, upTo || 0));
      const frag = document.createDocumentFragment();
      for (; shown < end; shown++) frag.append(makeRow(kids[shown]));
      ul.insertBefore(frag, more);
      const left = kids.length - shown;
      if (!left) { more.remove(); return; }
      more.replaceChildren(el("button.link", { type: "button", onclick: () => showMore() }, `Show ${Math.min(PAGE, left)} more (${left} left)`));
    };
    ul.append(more);
    ul.showUpTo = i => { if (i >= shown) showMore(i + 1); };
    showMore(minCount);
    return ul;
  }

  function toggle(n) {
    if (expanded.has(n)) expanded.delete(n);
    else expanded.add(n);
    rerender(n);
  }

  function rerender(n) {
    const li = rows.get(n);
    if (li) li.replaceWith(makeRow(n));
  }

  function valueEditor(n) {
    const v = n.textContent;
    let field;
    const commit = val => {
      val = val.replace(new RegExp(SaveFile.INVALID_CHAR.source, "g"), "");
      if (n.textContent !== val) { n.textContent = val; App.changed("tree", field); }
    };
    if (v.length > LONG) {
      return el("button.link.long", { type: "button", onclick: e => {
        const ta = el("textarea", { value: n.textContent, rows: 6, spellcheck: false, oninput: () => commit(ta.value) });
        field = ta;
        e.target.replaceWith(ta);
        ta.focus();
      } }, `long value (${v.length.toLocaleString()} chars), click to edit`);
    }
    const widthFor = s => Math.max(4, Math.min(60, s.length + 1));
    const input = el("input.val", { type: "text", value: v, spellcheck: false, size: widthFor(v), "aria-label": n.nodeName });
    field = input;
    if (/^-?\d+(\.\d+)?$/.test(v)) input.classList.add("num");
    else if (v === "True" || v === "False") input.classList.add("bool");
    input.oninput = () => { input.size = widthFor(input.value); commit(input.value); };
    return input;
  }

  // Squad members, vehicles and the save's top-level sections can't be
  // duplicated: the game expects exactly the ones it made.
  function canDuplicate(n) {
    return !(n.nodeName === "pc" || n.nodeName === "car" || n.parentNode === App.save.doc.documentElement);
  }
  function duplicate(n) {
    if (!canDuplicate(n)) { toast(`<${n.nodeName}> can't be duplicated safely`); return; }
    const copy = n.cloneNode(true);
    let renewed = 0;
    for (const u of [copy, ...copy.getElementsByTagName("*")].filter(e => e.nodeName === "uid")) {
      if (Model.GUID.test(u.textContent)) { u.textContent = uuid(); renewed++; }
    }
    n.after(copy);
    App.changed("tree");
    rerender(n.parentNode);
    toast(renewed ? `Duplicated with ${renewed} new uid${renewed === 1 ? "" : "s"}` : "Duplicated", { undo: true });
  }

  function remove(n) {
    const parent = n.parentNode;
    n.remove();
    for (const k of rows.keys()) if (!App.save.doc.contains(k)) rows.delete(k);
    App.changed("tree");
    rerender(parent);
    toast(`Deleted <${n.nodeName}>`, { undo: true });
  }

  function runSearch(q) {
    if (!q) { resultsEl.hidden = true; return; }
    const ql = q.toLowerCase();
    const all = App.save.doc.getElementsByTagName("*");
    const hits = [];
    let total = 0;
    for (let i = 0; i < all.length; i++) {
      const n = all[i];
      const nameHit = n.nodeName.toLowerCase().includes(ql);
      const valHit = isLeaf(n) && n.textContent.length < 5000 && n.textContent.toLowerCase().includes(ql);
      if (nameHit || valHit) { total++; if (hits.length < 300) hits.push(n); }
    }
    const summary = !total ? "No matches"
      : `${total.toLocaleString()} matches` + (total > hits.length ? `, showing the first ${hits.length}` : "");
    const preview = n => {
      if (isLeaf(n)) return el("span.val-preview", " = " + n.textContent.slice(0, 80));
      const hint = hintFor(n);
      return hint ? el("span.val-preview", ` (${hint})`) : null;
    };
    resultsEl.hidden = false;
    resultsEl.replaceChildren(
      el("div.muted", summary),
      el("ol", hits.map(n => el("li", el("button.link", { type: "button", onclick: () => reveal(n) }, el("span.path", pathOf(n)), preview(n))))));
  }

  function reveal(n) {
    const chain = [];
    for (let p = n.parentNode; p && p.nodeType === 1; p = p.parentNode) chain.unshift(p);
    for (const p of chain) {
      if (!expanded.has(p)) { expanded.add(p); rerender(p); }
      const li = rows.get(p);
      const ul = li && li.querySelector(":scope > ul.tree");
      const idx = children(p).indexOf(chain[chain.indexOf(p) + 1] || n);
      if (ul && ul.showUpTo) ul.showUpTo(idx);
    }
    const li = rows.get(n);
    if (!li) return;
    li.scrollIntoView({ block: "center", behavior: "smooth" });
    li.classList.remove("flash"); void li.offsetWidth; li.classList.add("flash");
    const input = li.querySelector(":scope > .node input");
    if (input) input.focus({ preventScroll: true });
  }

  let changeCursor = -1;
  function nextChange(dir) {
    const list = [...new Set(Changes.list().map(c => Model.changeNode(App.save.doc, c)).filter(Boolean))];
    if (!list.length) { toast("No changes yet"); return; }
    changeCursor = (changeCursor + dir + list.length) % list.length;
    reveal(list[changeCursor]);
    toast(`Change ${changeCursor + 1} of ${list.length}`);
  }

  return { render };
})();
