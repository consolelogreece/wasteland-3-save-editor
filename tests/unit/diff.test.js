"use strict";

describe("Diff", () => {
  let a, b;
  beforeEach(() => { a = Fixtures.doc(); b = Fixtures.doc(); });

  it("finds nothing in identical saves", () => {
    expect(Model.diff(a, b)).toEqual([]);
  });

  it("reports a changed value with a readable label", () => {
    setText(b.documentElement, "money", 999);
    const [c, ...rest] = Model.diff(a, b);
    expect(rest.length).toBe(0);
    expect(c.kind).toBe("changed");
    expect(c.before).toBe("5657");
    expect(c.after).toBe("999");
    expect(c.label).toBe("Money");
  });

  it("matches inventory items by uid, so adding one doesn't shift the rest", () => {
    Model.addInventoryItem(b, "ITM_Consumable_Healing_MedHypo", 2);
    const changes = Model.diff(a, b);
    expect(changes.length).toBe(1);
    expect(changes[0].kind).toBe("added");
    expect(changes[0].after).toBe("2 × " + displayName("ITM_Consumable_Healing_MedHypo"));
  });

  it("reports removed items", () => {
    b.querySelector("hostInventory > item").remove();
    const changes = Model.diff(a, b);
    expect(changes.map(c => c.kind)).toEqual(["removed"]);
    expect(changes[0].label).toContain("Inventory");
  });

  it("matches story flags by name", () => {
    Model.setGlobal(b, "G_Fame", 1);
    Model.setGlobal(b, "Brand_New", 1);
    const changes = Model.diff(a, b);
    expect(changes.map(c => c.kind + ":" + c.label)).toEqual(["changed:Story flags › G_Fame", "added:Story flags › Brand_New"]);
  });

  it("labels squad changes with the character's name", () => {
    Model.setSkill(Model.pcs(b)[0], "80", 9);
    expect(Model.diff(a, b)[0].label).toBe("Squad › Zoë & Co › Skills › Sniper Rifles › level");
  });

  it("lists comma-list entries one by one with readable names", () => {
    setText(b.documentElement, "appearances", "Scientist_Male_Chest,Elf_Male_Chest,Elf_Male_Legs");
    const changes = Model.diff(a, b);
    expect(changes.map(c => c.kind + ":" + c.csv).sort()).toEqual(["added:Elf_Male_Chest", "added:Elf_Male_Legs", "removed:RangerN_Male_Chest"]);
    expect(changes.find(c => c.csv === "Elf_Male_Chest").label).toBe("Unlocked outfits › " + displayName("Elf_Male_Chest"));
  });

  it("copies comma-list entries into another save", () => {
    setText(b.documentElement, "vehicleParts", "ITM_VehicleHood_WolfSkull,ITM_VehicleHood_Dragon");
    const target = Fixtures.doc();
    const r = Model.applyChanges(target, Model.diff(a, b));
    expect(r.failed).toEqual([]);
    expect(text(target.documentElement, "vehicleParts")).toBe("ITM_VehicleHood_WolfSkull,ITM_VehicleHood_Dragon");
  });

  it("shows game names for values that are codes", () => {
    const helmet = [...b.querySelectorAll("hostInventory > item")].find(i => text(i, "templateName").includes("Helmet"));
    setText(helmet, "templateName", "ITM_Consumable_Healing_MedHypo");
    const c = Model.diff(a, b).find(x => x.kind === "changed");
    expect(c.after).toBe("ITM_Consumable_Healing_MedHypo");
    expect(c.afterLabel).toBe(displayName("ITM_Consumable_Healing_MedHypo"));
  });

  it("ignores whitespace-only differences", () => {
    const x = Fixtures.doc("<save><a>1</a><b>2</b></save>");
    const y = Fixtures.doc("<save>\n  <a>1</a>\n  <b>2</b>\n</save>");
    expect(Model.diff(x, y)).toEqual([]);
  });

  it("skips branches it's told haven't changed", () => {
    setText(b.documentElement, "money", 1);
    expect(Model.diff(a, b, { unchanged: () => true })).toEqual([]);
  });

  it("can copy changes from one pair of saves into another", () => {
    Model.setGlobal(b, "G_Fame", 500);
    Model.setGlobal(b, "Quest_Fixed", 1);
    Model.addInventoryItem(b, "ITM_Consumable_Healing_MedHypo", 1);
    Model.deleteGlobal(b, "a5101_Patriarch_HadFirstConversation");
    const changes = Model.diff(a, b);
    const target = Fixtures.doc();
    setText(target.documentElement, "money", 1);
    const r = Model.applyChanges(target, changes);
    expect(r.applied).toBe(4);
    expect(r.failed).toEqual([]);
    expect(Model.getGlobal(target, "G_Fame")).toBe("500");
    expect(Model.getGlobal(target, "Quest_Fixed")).toBe("1");
    expect(Model.getGlobal(target, "a5101_Patriarch_HadFirstConversation")).toBe(undefined);
    expect(text(target.querySelector("hostInventory > item:first-child"), "templateName")).toBe("ITM_Consumable_Healing_MedHypo");
    expect(text(target.documentElement, "money")).toBe("1");
  });

  it("reports changes it can't copy", () => {
    Model.setGlobal(b, "G_Fame", 1);
    const changes = Model.diff(a, b);
    const target = Fixtures.doc();
    Model.deleteGlobal(target, "G_Fame");
    const r = Model.applyChanges(target, changes);
    expect(r.applied).toBe(0);
    expect(r.failed.length).toBe(1);
  });

  it("resolves paths back to nodes", () => {
    Model.setGlobal(b, "G_Fame", 1);
    const [c] = Model.diff(a, b);
    expect(Model.resolve(b, c.path)).toBe(c.node);
  });
});

describe("Copying changes between saves safely", () => {
  const skeleton = inner => `<save><version>1</version><pcs></pcs><hostInventory></hostInventory><globals></globals>${inner}</save>`;
  const list = (...vals) => skeleton("<a>" + vals.map(v => `<e><q>${v}</q></e>`).join("") + "</a>");
  const values = d => [...d.querySelectorAll("a > e > q")].map(q => q.textContent);

  it("writes codes, not display names, when copying a changed code", () => {
    const a = Fixtures.doc(), b = Fixtures.doc(), target = Fixtures.doc();
    const pick = d => [...d.querySelectorAll("hostInventory > item")].find(i => text(i, "templateName") === "ITM_Consumable_Healing_MedicPack");
    setText(pick(b), "templateName", "ITM_Consumable_Healing_MedHypo");
    const r = Model.applyChanges(target, Model.diff(a, b));
    expect(r.applied).toBe(1);
    const saved = SaveFile.read(SaveFile.write({ fields: Fixtures.load().fields, doc: target }).bytes.buffer).doc;
    expect(text(saved.querySelector("hostInventory > item"), "templateName")).toBe("ITM_Consumable_Healing_MedHypo");
  });

  it("removes the right elements when several go from one list", () => {
    const a = Fixtures.doc(list("A", "B", "C", "D")), b = Fixtures.doc(list("A", "D")), target = Fixtures.doc(list("A", "B", "C", "D"));
    const r = Model.applyChanges(target, Model.diff(a, b));
    expect(r.failed).toEqual([]);
    expect(values(target)).toEqual(["A", "D"]);
  });

  it("keeps the order of alternating elements", () => {
    const pairs = n => skeleton("<m>" + Array.from({ length: n }, (_, i) => `<mod>${i}</mod><perceived>True</perceived>`).join("") + "</m>");
    const a = Fixtures.doc(pairs(1)), b = Fixtures.doc(pairs(3)), target = Fixtures.doc(pairs(1));
    Model.applyChanges(target, Model.diff(a, b));
    expect(children(target.querySelector("m")).map(c => c.nodeName).join(",")).toBe("mod,perceived,mod,perceived,mod,perceived");
    expect(Model.diff(b, target)).toEqual([]);
  });

  it("puts added items in the same place", () => {
    const a = Fixtures.doc(), b = Fixtures.doc(), target = Fixtures.doc();
    Model.addInventoryItem(b, "ITM_Consumable_Healing_MedHypo", 1);
    Model.applyChanges(target, Model.diff(a, b));
    expect(text(target.querySelector("hostInventory > item"), "templateName")).toBe("ITM_Consumable_Healing_MedHypo");
  });

  it("finds squad members by who they are, not where they are in the list", () => {
    const a = Fixtures.doc(), b = Fixtures.doc(), target = Fixtures.doc();
    setText(Model.pcs(b)[1], "xp", 99999);
    const pcs = target.querySelector("pcs");
    pcs.prepend(Model.pcs(target)[1]);
    const r = Model.applyChanges(target, Model.diff(a, b));
    expect(r.failed).toEqual([]);
    const lucia = Model.pcs(target).find(p => text(p, "companionId") === "7");
    expect(text(lucia, "xp")).toBe("99999");
    expect(text(Model.pcs(target).find(p => text(p, "companionId") === "-1"), "xp")).toBe("57758");
  });

  it("refuses squad changes when it can't tell members apart", () => {
    const anon = skeleton("").replace("<pcs></pcs>", "<pcs><pc><xp>1</xp></pc><pc><xp>2</xp></pc></pcs>");
    const a = Fixtures.doc(anon), b = Fixtures.doc(anon.replace("<xp>2</xp>", "<xp>5</xp>")), target = Fixtures.doc(anon);
    const r = Model.applyChanges(target, Model.diff(a, b));
    expect(r.applied).toBe(0);
    expect(r.failed.length).toBe(1);
    expect(SaveFile.serialize(target, false)).toBe(anon);
  });

  it("skips a value that's different in the target unless forced", () => {
    const a = Fixtures.doc(), b = Fixtures.doc(), target = Fixtures.doc();
    setText(b.documentElement, "money", 20);
    setText(target.documentElement, "money", 999);
    const changes = Model.diff(a, b);
    const r = Model.applyChanges(target, changes);
    expect(r.applied).toBe(0);
    expect(r.conflicts.length).toBe(1);
    expect(r.conflicts[0].current).toBe("999");
    expect(text(target.documentElement, "money")).toBe("999");
    Model.applyChanges(target, changes, { force: true });
    expect(text(target.documentElement, "money")).toBe("20");
  });

  it("notices attribute changes", () => {
    const a = Fixtures.doc(skeleton('<n a="1">x</n>')), b = Fixtures.doc(skeleton('<n a="2">x</n>'));
    expect(Model.diff(a, b).length).toBe(1);
  });

  const inv = (...items) => skeleton("").replace("<hostInventory></hostInventory>", "<hostInventory>" + items.map(([uid, q]) => `<item><uid>${uid}</uid><templateName>ITM_X</templateName><quantity>${q}</quantity></item>`).join("") + "</hostInventory>");
  const quantities = d => [...d.querySelectorAll("hostInventory > item")].map(i => text(i, "uid") + "=" + text(i, "quantity"));

  it("won't delete an item that's different in the target unless forced", () => {
    const a = Fixtures.doc(inv(["u1", 5], ["u2", 1])), b = Fixtures.doc(inv(["u2", 1])), target = Fixtures.doc(inv(["u1", 50], ["u2", 1]));
    const changes = Model.diff(a, b);
    let r = Model.applyChanges(target, changes);
    expect(r.applied).toBe(0);
    expect(r.conflicts.length).toBe(1);
    expect(quantities(target)).toEqual(["u1=50", "u2=1"]);
    r = Model.applyChanges(target, changes, { force: true });
    expect(quantities(target)).toEqual(["u2=1"]);
  });

  it("won't replace a whole element that's different in the target unless forced", () => {
    const a = Fixtures.doc(skeleton("<m><mod>1</mod><perceived>True</perceived></m>"));
    const b = Fixtures.doc(skeleton("<m><mod>1</mod><perceived>True</perceived><mod>2</mod><perceived>True</perceived></m>"));
    const target = Fixtures.doc(skeleton("<m><mod>9</mod><perceived>True</perceived></m>"));
    const r = Model.applyChanges(target, Model.diff(a, b));
    expect(r.conflicts.length).toBe(1);
    expect(target.querySelector("m mod").textContent).toBe("9");
  });

  it("matches a lone item by its uid, not its position", () => {
    const a = Fixtures.doc(inv(["u1", 5])), b = Fixtures.doc(inv(["u9", 1], ["u1", 5]));
    const changes = Model.diff(a, b);
    expect(changes.map(c => c.kind)).toEqual(["added"]);
    const target = Fixtures.doc(inv(["u1", 5]));
    Model.applyChanges(target, changes);
    expect(quantities(target).sort()).toEqual(["u1=5", "u9=1"]);
  });

  it("changes the right item when the target has others", () => {
    const a = Fixtures.doc(inv(["u1", 5])), b = Fixtures.doc(inv(["u1", 6]));
    const target = Fixtures.doc(inv(["u7", 5], ["u1", 5]));
    Model.applyChanges(target, Model.diff(a, b));
    expect(quantities(target)).toEqual(["u7=5", "u1=6"]);
  });

  it("matches a renamed ranger by their creation key, not their name", () => {
    const a = Fixtures.doc(), b = Fixtures.doc(), target = Fixtures.doc();
    for (const d of [a, b, target]) setText(Model.pcs(d)[0], "clientUniqueUGCKey", "key-1");
    setText(Model.pcs(b)[0], "displayName", "Renamed");
    Model.applyChanges(target, Model.diff(a, b));
    expect(Model.pcs(target).length).toBe(Model.pcs(a).length);
    expect(text(Model.pcs(target)[0], "displayName")).toBe("Renamed");
  });

  it("matches a one-entry list of plain values by value", () => {
    const abilities = (...codes) => skeleton("<ab>" + codes.map(c => `<ability>${c}</ability>`).join("") + "</ab>");
    const a = Fixtures.doc(abilities("A")), b = Fixtures.doc(abilities("A", "B")), target = Fixtures.doc(abilities("A", "B"));
    Model.applyChanges(target, Model.diff(a, b));
    expect([...target.querySelectorAll("ab > ability")].map(n => n.textContent)).toEqual(["A", "B"]);
  });
});
