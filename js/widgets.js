// Search picker, dialogs and menus.
"use strict";

const pickerIndexes = new WeakMap();
function pickerIndex(entries) {
  let idx = pickerIndexes.get(entries);
  if (idx) return idx;
  idx = entries.map(e => {
    const item = typeof e === "string" ? { value: e, code: e } : { ...e };
    item.name = item.name || displayName(item.code || item.value);
    item.sub = item.sub !== undefined ? item.sub : item.code || "";
    item.hay = (item.name + " " + (item.code || "") + " " + (item.extra || "")).toLowerCase();
    item.nameLower = item.name.toLowerCase();
    return item;
  });
  pickerIndexes.set(entries, idx);
  return idx;
}

function searchEntries(entries, query, limit = 60) {
  const idx = pickerIndex(entries);
  const q = query.trim().toLowerCase();
  if (!q) return idx.slice(0, limit);
  const words = q.split(/\s+/);
  const hits = [];
  for (const e of idx) {
    if (!words.every(w => e.hay.includes(w))) continue;
    let score = 3;
    if (e.nameLower === q) score = 0;
    else if (e.nameLower.startsWith(q)) score = 1;
    else if (e.nameLower.includes(q)) score = 2;
    hits.push([e.rank || 0, score, e.name.length, e]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return hits.slice(0, limit).map(h => h[3]);
}

let pickerCount = 0;

// codePicker({ entries, placeholder, onPick(value, entry), thumbs, addLabel, label })
// entries: array of codes, or { value, code?, name?, sub?, extra?, rank? } objects.
// Lower rank sorts first. With addLabel, choosing from the list only selects;
// onPick runs when the button next to the box is pressed.
function codePicker({ entries, placeholder = "Search…", onPick, thumbs = false, addLabel = null, label = placeholder }) {
  let results = [], active = -1, selected = null;
  const listId = "picker-" + (++pickerCount);
  const input = el("input", {
    type: "text", placeholder, spellcheck: false, autocomplete: "off", role: "combobox",
    "aria-expanded": "false", "aria-autocomplete": "list", "aria-controls": listId, "aria-label": label,
  });
  input.dataset.key = "picker:" + label;
  const list = el("ul.picker-list", { id: listId, role: "listbox", hidden: true });
  const confirm = () => {
    if (!selected) { input.focus(); return; }
    const entry = selected;
    selected = null;
    input.value = "";
    addBtn.disabled = true;
    onPick(entry.value, entry);
    refocus(input);
  };
  const addBtn = addLabel ? el("button.btn.primary", { type: "button", disabled: true, onclick: confirm }, addLabel) : null;
  const wrap = el("div.picker", addBtn ? el("div.picker-row", input, addBtn) : input, list);

  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const highlight = i => {
    active = i;
    [...list.children].forEach((li, j) => {
      li.classList.toggle("active", j === i);
      li.setAttribute("aria-selected", String(j === i));
    });
    const current = list.children[i];
    if (!current) { input.removeAttribute("aria-activedescendant"); return; }
    current.scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", current.id);
  };
  const pick = entry => {
    if (!entry) return;
    close();
    if (addBtn) {
      selected = entry;
      input.value = entry.name;
      addBtn.disabled = false;
      return;
    }
    input.value = "";
    onPick(entry.value, entry);
    input.focus();
  };
  const draw = () => {
    results = searchEntries(entries, input.value);
    list.replaceChildren(...results.map((e, i) => el("li", {
      role: "option", id: `${listId}-${i}`,
      onmousedown: ev => { ev.preventDefault(); pick(e); },
      onmousemove: () => active !== i && highlight(i),
    }, thumbs ? wikiThumb(e.name) : null, el("span.grow", el("strong", e.name), e.sub ? el("span.code", e.sub) : null))));
    if (!results.length) list.append(el("li.empty", "No matches."));
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    highlight(results.length ? 0 : -1);
  };
  input.addEventListener("input", () => {
    if (selected) { selected = null; addBtn.disabled = true; }
    draw();
  });
  input.addEventListener("focus", () => { if (!selected) draw(); });
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (list.hidden) draw();
      else highlight(Math.min(results.length - 1, active + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlight(Math.max(0, active - 1));
    } else if (e.key === "Escape" && !list.hidden) {
      e.stopPropagation();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selected && list.hidden) confirm();
      else if (active >= 0 && results[active]) pick(results[active]);
    }
  });
  wrap.input = input;
  return wrap;
}

function refocus(node) {
  if (!node) return;
  if (node.isConnected) { node.focus(); return; }
  const key = node.dataset && node.dataset.key;
  const again = key && document.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (again) again.focus();
}

// Returns { box, close }. The page behind is made inert.
function modal(title, body, actions = []) {
  const prevFocus = document.activeElement;
  const behind = [...document.body.children].filter(n => n.matches("header, nav, main, #banner"));
  for (const n of behind) n.inert = true;
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    if (!document.querySelector(".overlay")) for (const n of behind) n.inert = false;
    refocus(prevFocus);
  };
  const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const actionButton = a => el("button.btn" + (a.primary ? ".primary" : ""), {
    type: "button", onclick: () => { if (a.onClick() !== false) close(); },
  }, a.label);
  const box = el("div.modal", { role: "dialog", "aria-modal": "true", "aria-label": title },
    el("div.modal-head", el("h2", title), el("button.icon", { type: "button", title: "Close", onclick: close }, "✕")),
    el("div.modal-body", body),
    actions.length ? el("div.modal-actions", actions.map(actionButton)) : null);
  const overlay = el("div.overlay", { onmousedown: e => { if (e.target === overlay) close(); } }, box);
  document.body.append(overlay);
  document.addEventListener("keydown", onKey, true);
  const first = box.querySelector(".modal-body input, .modal-body select")
    || box.querySelector(".modal-actions .btn.primary")
    || box.querySelector("button");
  if (first) first.focus();
  return { box, close };
}

function popupMenu(anchor, items) {
  document.querySelectorAll(".menu").forEach(m => m.remove());
  const close = returnFocus => {
    menu.remove();
    document.removeEventListener("mousedown", onOutsideClick, true);
    if (returnFocus && anchor.isConnected) anchor.focus();
  };
  const onOutsideClick = e => { if (!menu.contains(e.target)) close(false); };
  const menu = el("div.menu", { role: "menu" }, items.map(item => item.header
    ? el("div.menu-head", item.header)
    : el("button", { type: "button", role: "menuitem", disabled: item.disabled, onclick: () => { close(false); item.onClick(); } }, item.label)));
  document.body.append(menu);

  const r = anchor.getBoundingClientRect();
  const fitsBelow = r.bottom + 4 + menu.offsetHeight <= innerHeight;
  menu.style.left = Math.min(r.left, innerWidth - menu.offsetWidth - 8) + "px";
  menu.style.top = (fitsBelow ? r.bottom + 4 : Math.max(8, r.top - menu.offsetHeight - 4)) + "px";
  setTimeout(() => document.addEventListener("mousedown", onOutsideClick, true));

  menu.addEventListener("keydown", e => {
    const buttons = [...menu.querySelectorAll("button:not([disabled])")];
    const i = buttons.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
    else if (e.key === "Tab") close(false);
  });
  const first = menu.querySelector("button:not([disabled])");
  if (first) first.focus();
  return menu;
}

function flash(node) {
  if (!node) return;
  node.scrollIntoView({ block: "center", behavior: "smooth" });
  node.classList.remove("flash"); void node.offsetWidth; node.classList.add("flash");
  const field = node.matches("input, select, textarea") ? node : node.querySelector("input, select, textarea");
  if (field) field.focus({ preventScroll: true });
}
