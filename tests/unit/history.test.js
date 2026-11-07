"use strict";

describe("Undo and redo", () => {
  beforeEach(() => {
    App.save = { doc: Fixtures.doc(), fields: [], originalXmlBytes: new TextEncoder().encode(Fixtures.XML) };
    History.attach(App.save.doc);
  });
  const money = () => text(App.save.doc.documentElement, "money");
  const xml = () => SaveFile.serialize(App.save.doc, false);

  it("undoes and redoes a value change", () => {
    setText(App.save.doc.documentElement, "money", 1);
    App.changed("test");
    expect(History.undo()).toBeTruthy();
    expect(money()).toBe("5657");
    expect(History.redo()).toBeTruthy();
    expect(money()).toBe("1");
  });

  it("returns false with nothing to undo", () => {
    expect(History.undo()).toBeFalsy();
    expect(History.redo()).toBeFalsy();
  });

  it("restores the exact XML after several kinds of edit", () => {
    const before = xml();
    const d = App.save.doc;
    Model.addInventoryItem(d, "ITM_Scrap", 3); App.changed("test");
    Model.equip(Model.pcs(d)[0], 28, [...d.querySelectorAll("hostInventory > item")].find(i => text(i, "templateName").includes("Helmet"))); App.changed("test");
    Model.addPerk(Model.pcs(d)[0], "PRK_Leadership_Rally"); App.changed("test");
    Model.deleteGlobal(d, "G_Fame"); App.changed("test");
    const after = xml();
    while (History.undo());
    expect(xml()).toBe(before);
    while (History.redo());
    expect(xml()).toBe(after);
  });

  it("merges quick edits to the same field into one step", () => {
    const key = {};
    for (const v of ["1", "12", "123"]) { setText(App.save.doc.documentElement, "money", v); App.changed("test", key); }
    History.undo();
    expect(money()).toBe("5657");
  });

  it("keeps edits to different fields as separate steps", () => {
    setText(App.save.doc.documentElement, "money", 1); App.changed("test", {});
    setText(App.save.doc.documentElement, "difficulty", 0); App.changed("test", {});
    History.undo();
    expect(money()).toBe("1");
    expect(text(App.save.doc.documentElement, "difficulty")).toBe("3");
  });

  it("clears redo after a new edit", () => {
    setText(App.save.doc.documentElement, "money", 1); App.changed("test");
    History.undo();
    setText(App.save.doc.documentElement, "money", 2); App.changed("test");
    expect(History.canRedo()).toBeFalsy();
  });

  it("undoes swapping in a whole new document", () => {
    const first = App.save.doc;
    const second = Fixtures.doc(Fixtures.XML.replace("<money>5657</money>", "<money>42</money>"));
    App.save.doc = second;
    History.swapped(first, second);
    App.changed("raw");
    History.undo();
    expect(App.save.doc).toBe(first);
    History.redo();
    expect(App.save.doc).toBe(second);
    expect(money()).toBe("42");
  });
});
