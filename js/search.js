// Quick search (Ctrl+K): jump to any setting, character, item or story flag,
// or add something straight from the code lists.
"use strict";

const QuickSearch = (() => {
  const jumpTo = (name, sub, target, extra = "") => ({ value: () => Main.goEditor(target), name, sub, extra });

  function settings(doc) {
    const out = [
      jumpTo("Money", "Overview", { focus: "money" }, "cash dollars"),
      jumpTo("Scrap", "Overview", { focus: "scrap" }),
      ...Model.PARTY_STATS.map(stat => jumpTo(stat.label, "Overview", { focus: stat.key })),
    ];
    Model.pcs(doc).forEach((pc, i) => {
      const name = Model.pcName(pc, i);
      out.push(
        jumpTo(name, "Squad member", { view: "squad", pc: i }, "character ranger"),
        jumpTo(`${name}: unspent skill points`, "Squad", { view: "squad", pc: i, focus: "skillpoints" }),
        jumpTo(`${name}: unspent attribute points`, "Squad", { view: "squad", pc: i, focus: "attrpoints" }));
    });
    out.push(
      jumpTo("Shared inventory", "Inventory", { view: "inventory" }, "items stash"),
      jumpTo("Kodiak", "Vehicle", { view: "kodiak" }, "car vehicle turret"),
      ...Model.COLLECTIONS.map(def => jumpTo(def.label, "Collectibles", { view: "collectibles", open: "col-" + def.key, focus: "col-" + def.key })),
      ...Model.reputations(doc).map(r => jumpTo(`Reputation: ${r.label}`, "World & story", { view: "world", focus: r.k }, "faction")),
      jumpTo("Story flags", "World & story", { view: "world" }, "globals quests"));
    return out;
  }

  function inventory(doc) {
    const codes = new Set(children(child(doc.documentElement, "hostInventory"), "item").map(i => text(i, "templateName")));
    return [...codes].map(code => ({
      value: () => Main.goEditor({ view: "inventory", inventoryFilter: displayName(code) }),
      name: displayName(code), sub: "In your inventory", code, extra: code,
    }));
  }

  function storyFlags(doc) {
    return Model.listGlobals(doc).map(g => ({
      value: () => Main.goEditor({ view: "world", flag: g.k, focus: "flag:" + g.k }),
      name: g.k, sub: `Story flag = ${g.v}`,
    }));
  }

  function itemCodes() {
    return metaData.Items.map(code => {
      if (Model.isInventoryCode(code)) {
        return { value: () => SimpleEditor.addItem(code, 1), name: "Add " + displayName(code), sub: code, code, extra: displayName(code) };
      }
      const def = Model.collectionFor(code);
      const kind = def ? def.label.replace(/s$/, "") : "Outfit";
      return {
        value: () => Main.goCollectible(code),
        name: `${displayName(code)} (${kind.toLowerCase()})`, sub: "Show in Collectibles", code, extra: code, rank: 1,
      };
    });
  }

  function tabs() {
    return [["Compare two saves", "compare"], ["Code lists", "codes"], ["Help", "help"]]
      .map(([name, tab]) => ({ value: () => Main.showTab(tab), name, sub: "Tab" }));
  }

  function entries() {
    if (!App.save) return tabs();
    const doc = App.save.doc;
    return [...settings(doc), ...inventory(doc), ...storyFlags(doc), ...itemCodes(), ...tabs()];
  }

  function open() {
    // Unapplied raw edits are applied (or refused) first, so a jump or an add
    // can't be lost when they're applied later.
    if (!Main.leaveRaw()) return;
    const picker = codePicker({
      entries: entries(),
      placeholder: App.save ? "Search settings, characters, items, story flags…" : "Open a save to search it…",
      onPick: go => { dialog.close(); go(); },
    });
    const dialog = modal("Search", el("div", picker, el("p.hint", "Type an item name and pick the \"Add\" result to put it in the inventory.")));
    picker.input.focus();
  }

  addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open(); }
  });

  return { open };
})();
