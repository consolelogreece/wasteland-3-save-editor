// Undo/redo for every kind of edit. Instead of each view recording its own
// undo steps, a MutationObserver watches the save's XML document; each call to
// App.changed() closes off one undo step. Undoing replays the records in
// reverse, and the observer captures that as the redo step (and vice versa).
"use strict";

const History = (() => {
  const LIMIT = 300;
  const SWAP_LIMIT = 20;   // each raw-editor swap keeps a whole copy of the save
  const MERGE_MS = 1500;
  let observer = null, doc = null;
  let undoStack = [], redoStack = [];
  let applying = false, lastKey = null, lastTime = 0;
  const listeners = [];

  function attach(newDoc, { keepStacks = false } = {}) {
    if (observer) observer.disconnect();
    doc = newDoc;
    if (!keepStacks) { undoStack = []; redoStack = []; lastKey = null; }
    if (!doc) { notify(); return; }
    observer = new MutationObserver(() => {});
    observer.observe(doc, { subtree: true, childList: true, characterData: true, characterDataOldValue: true, attributes: true, attributeOldValue: true });
    notify();
  }

  function pending() { return observer ? observer.takeRecords() : []; }

  // Close the current step. Edits with the same key in quick succession (e.g.
  // typing into one field) merge into one step.
  function commit(key) {
    if (applying || !observer) return;
    const records = pending();
    if (!records.length) return;
    redoStack = [];
    const now = Date.now();
    const top = undoStack[undoStack.length - 1];
    if (key && key === lastKey && now - lastTime < MERGE_MS && top && top.records) top.records.push(...records);
    else undoStack.push({ records });
    if (undoStack.length > LIMIT) undoStack.shift();
    lastKey = key; lastTime = now;
    notify();
  }

  function swapped(fromDoc, toDoc) {
    commit();
    undoStack.push({ swap: { from: fromDoc, to: toDoc } });
    redoStack = [];
    while (undoStack.length > LIMIT) undoStack.shift();
    let swaps = undoStack.filter(e => e.swap).length;
    while (swaps > SWAP_LIMIT) { undoStack.shift(); swaps = undoStack.filter(e => e.swap).length; }
    attach(toDoc, { keepStacks: true });
  }

  function revert(records) {
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      if (r.type === "characterData") r.target.data = r.oldValue;
      else if (r.type === "attributes") {
        if (r.oldValue === null) r.target.removeAttribute(r.attributeName);
        else r.target.setAttribute(r.attributeName, r.oldValue);
      } else {
        for (const n of r.addedNodes) if (n.parentNode === r.target) r.target.removeChild(n);
        const before = r.nextSibling && r.nextSibling.parentNode === r.target ? r.nextSibling : null;
        for (const n of r.removedNodes) r.target.insertBefore(n, before);
      }
    }
  }

  function step(from, to) {
    commit();
    const entry = from.pop();
    if (!entry) return false;
    lastKey = null;
    if (entry.swap) {
      const target = from === undoStack ? entry.swap.from : entry.swap.to;
      App.save.doc = target;
      attach(target, { keepStacks: true });
      to.push(entry);
    } else {
      applying = true;
      try {
        pending();
        revert(entry.records);
        to.push({ records: pending() });
      } finally { applying = false; }
    }
    App.changed("history");
    notify();
    return true;
  }

  const undo = () => step(undoStack, redoStack);
  const redo = () => step(redoStack, undoStack);

  function notify() { for (const fn of listeners) fn({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 }); }
  function onUpdate(fn) { listeners.push(fn); }

  return { attach, commit, swapped, undo, redo, onUpdate, canUndo: () => undoStack.length > 0, canRedo: () => redoStack.length > 0 };
})();
