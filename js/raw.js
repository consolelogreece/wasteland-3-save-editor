// Raw XML view. Shows a formatted copy of the save; edits are only applied
// once the XML is valid. Lines holding changed values are highlighted.
"use strict";

const RawEditor = (() => {
  let root, cm, textarea, statusEl, shownDoc = null, shownVersion = -1, pending = false, version = 0;
  let lineOf = new Map(), marked = [];

  App.onChange(src => { if (src !== "raw") version++; });
  Changes.onUpdate(() => { if (cm && !pending && root && root.offsetParent) markChanges(); });

  const getValue = () => (cm ? cm.getValue() : textarea.value);
  function setValue(v) { if (cm) { cm.setValue(v); cm.clearHistory(); } else textarea.value = v; }

  function ensureEditor() {
    if (cm || textarea) return;
    statusEl = el("div.raw-status");
    const host = el("div.raw-host");
    root.replaceChildren(
      caution("Only basic checks in this view.", "Anything that's valid XML is saved as you typed it. Use the ", jumpLink("Editor view", () => Main.setView("simple")), " where you can."),
      el("div.card.raw-tools",
        el("span.muted", "Ctrl+F searches, Alt+G jumps to a line. Edits are checked and applied when you switch away or download. Highlighted lines have changed since you opened the save."),
        el("button.btn", { type: "button", onclick: () => apply(true) }, "Check & apply"),
        el("button.btn", { type: "button", onclick: discard }, "Discard edits")),
      statusEl, host);
    if (window.CodeMirror) {
      cm = CodeMirror(host, { mode: "xml", lineNumbers: true, lineWrapping: false, viewportMargin: 20, gutters: ["changes", "CodeMirror-linenumbers"] });
      cm.on("change", (_, ch) => { if (ch.origin !== "setValue") markPending(); });
    } else {
      textarea = el("textarea.raw-fallback", { spellcheck: false });
      textarea.oninput = markPending;
      host.append(textarea);
    }
  }

  function markPending() {
    if (pending) return;
    pending = true;
    App.dirty = true;
    status("Unapplied edits. They're checked when you switch away.", "warn");
  }

  function status(msg, kind) {
    statusEl.className = "raw-status " + (kind || "");
    statusEl.textContent = msg || "";
    statusEl.hidden = !msg;
  }

  function markChanges() {
    if (!cm) return;
    cm.operation(() => {
      for (const l of marked) { cm.removeLineClass(l, "background", "line-changed"); cm.setGutterMarker(l, "changes", null); }
      marked = [];
      for (const c of Changes.list()) {
        const n = Model.changeNode(App.save.doc, c);
        const line = n && lineOf.get(n);
        if (line === undefined) continue;
        // A removed element only marks its parent's first line.
        const last = c.kind === "removed" && !c.csv ? line : lineOf.ends.get(n) ?? line;
        for (let l = line; l <= last; l++) marked.push(cm.addLineClass(l, "background", "line-changed"));
        cm.setGutterMarker(line, "changes", el("span.gutter-mark", { title: c.label }, c.kind === "removed" ? "−" : c.kind === "added" ? "+" : "●"));
        marked.push(line);
      }
    });
  }

  function render(container) {
    root = container || root;
    if (!App.save) { root.replaceChildren(); cm = textarea = null; shownDoc = null; return; }
    ensureEditor();
    if (!pending && (shownDoc !== App.save.doc || shownVersion !== version)) {
      status("Formatting XML…");
      setTimeout(() => {
        if (pending) { status("Unapplied edits. They're checked when you switch away.", "warn"); return; }
        lineOf = new Map();
        lineOf.ends = new Map();
        setValue(SaveFile.serialize(App.save.doc, true, lineOf));
        marked = [];
        shownDoc = App.save.doc; shownVersion = version;
        status("");
        if (cm) { cm.refresh(); Changes.compute(); markChanges(); }
      }, 10);
    } else if (cm) cm.refresh();
  }

  function apply(explicit) {
    if (!pending) { if (explicit) status("No unapplied edits.", "ok"); return true; }
    const next = new DOMParser().parseFromString(getValue(), "application/xml");
    const err = next.querySelector("parsererror");
    if (err) {
      const msg = err.textContent.replace(/\s+/g, " ").replace(/^This page contains the following errors:\s*/i, "").replace(/Below is a rendering.*$/i, "").trim();
      const m = /line (\d+) at column (\d+)/.exec(msg);
      status("Invalid XML, so the edits were not applied: " + msg.slice(0, 240), "error");
      if (m && cm) { const line = +m[1] - 1; cm.setCursor({ line, ch: +m[2] - 1 }); cm.scrollIntoView({ line, ch: 0 }, 120); cm.focus(); }
      return false;
    }
    if (next.documentElement.nodeName !== "save") {
      status("The root element must be <save>, so the edits were not applied.", "error");
      return false;
    }
    // A save without these isn't loadable; refuse rather than write it.
    const missing = ["version", "pcs", "hostInventory", "globals"].filter(t => !child(next.documentElement, t));
    if (missing.length) {
      status("These parts of the save are missing, so the edits were not applied: " + missing.join(", ") + ".", "error");
      return false;
    }
    const bad = SaveFile.findInvalidChar(next.documentElement);
    if (bad) {
      status(`<${bad.nodeName}> contains a character that isn't allowed in a save, so the edits were not applied.`, "error");
      return false;
    }
    SaveFile.stripWhitespace(next.documentElement);
    const prev = App.save.doc;
    App.save.doc = next;
    History.swapped(prev, next);
    pending = false;
    App.changed("raw");
    // Reformat so line highlights line up with the new document.
    lineOf = new Map();
    lineOf.ends = new Map();
    const formatted = SaveFile.serialize(next, true, lineOf);
    if (cm) {
      const pos = cm.getScrollInfo(), cur = cm.getCursor();
      setValue(formatted);
      cm.scrollTo(pos.left, pos.top);
      cm.setCursor(cur);
      marked = [];
      Changes.compute();
      markChanges();
    } else if (textarea) setValue(formatted);
    shownDoc = next;
    shownVersion = version;
    status("Applied.", "ok");
    return true;
  }

  function discard() {
    pending = false;
    shownDoc = null;
    render();
  }

  return { render, apply, discard, hasPending: () => pending, reset() { pending = false; shownDoc = null; version++; } };
})();
