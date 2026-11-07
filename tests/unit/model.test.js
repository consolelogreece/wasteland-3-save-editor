"use strict";

let d;
const pcAt = i => Model.pcs(d)[i];

describe("Story flags and party stats", () => {
  beforeEach(() => { d = Fixtures.doc(); });

  it("reads and writes existing flags", () => {
    expect(Model.getGlobal(d, "G_Fame")).toBe("107");
    expect(Model.setGlobal(d, "G_Fame", 200)).toBeTruthy();
    expect(Model.getGlobal(d, "G_Fame")).toBe("200");
  });

  it("reports no change when the value is the same", () => {
    expect(Model.setGlobal(d, "G_Fame", 107)).toBeFalsy();
  });

  it("creates missing flags at the end of globals", () => {
    Model.setGlobal(d, "My_New_Flag", 3);
    const last = d.querySelector("globals").lastElementChild;
    expect(text(last, "k")).toBe("My_New_Flag");
    expect(text(last, "v")).toBe("3");
  });

  it("deletes flags", () => {
    expect(Model.deleteGlobal(d, "G_Fame")).toBeTruthy();
    expect(Model.getGlobal(d, "G_Fame")).toBe(undefined);
    expect(Model.deleteGlobal(d, "G_Fame")).toBeFalsy();
  });

  it("lists faction reputation but not the 'changed' markers", () => {
    const reps = Model.reputations(d);
    expect(reps.map(r => r.k)).toEqual(["G_Reputation_Gippers"]);
    expect(reps[0].label).toBe("Gippers");
    expect(reps[0].v).toBe("-1996");
  });
});

describe("Inventory", () => {
  beforeEach(() => { d = Fixtures.doc(); });

  it("adds an item at the top with every field the game writes", () => {
    const it = Model.addInventoryItem(d, "ITM_Consumable_Healing_MedHypo", 5);
    expect(d.querySelector("hostInventory").firstElementChild).toBe(it);
    expect(children(it).map(c => c.nodeName)).toEqual(["templateName", "slot", "ammoLoaded", "quantity", "uid", "isLockedForMerchant", "merchantBarterLevelRequirement"]);
    expect(text(it, "quantity")).toBe("5");
    expect(text(it, "uid")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("won't put outfits in the inventory", () => {
    expect(() => Model.addInventoryItem(d, "ITM_Appearance_HipsterOutfit", 1)).toThrow(/outfit/);
  });

  it("unlocks a known outfit's pieces", () => {
    const n = Model.unlockOutfit(d, "ITM_Appearance_ElfOutfit");
    expect(n).toBeGreaterThan(0);
    const have = Model.getCollection(d, Model.COLLECTIONS.find(c => c.key === "appearances"));
    expect(have.includes("Elf_Male_Chest")).toBeTruthy();
    expect(Model.unlockOutfit(d, "ITM_Appearance_ElfOutfit")).toBe(0);
    expect(Model.unlockOutfit(d, "ITM_Appearance_HipsterOutfit")).toBe(null);
  });

  it("refuses codes with odd characters", () => {
    expect(() => Model.addInventoryItem(d, "ITM_<bad>", 1)).toThrow(/valid item code/);
  });

  it("clamps quantity to at least 1", () => {
    expect(text(Model.addInventoryItem(d, "ITM_Scrap", 0), "quantity")).toBe("1");
  });

  it("duplicates with a new uid", () => {
    const first = d.querySelector("hostInventory > item");
    const copy = Model.duplicateItem(first);
    expect(first.nextElementSibling).toBe(copy);
    expect(text(copy, "templateName")).toBe(text(first, "templateName"));
    expect(text(copy, "uid") === text(first, "uid")).toBeFalsy();
  });

  it("reads and sets scrap, merging stacks", () => {
    expect(Model.getScrap(d)).toBe(9272);
    Model.addInventoryItem(d, "ITM_Scrap", 8);
    expect(Model.getScrap(d)).toBe(9280);
    Model.setScrap(d, 50);
    expect(Model.getScrap(d)).toBe(50);
    expect([...d.querySelectorAll("hostInventory > item")].filter(i => text(i, "templateName") === "ITM_Scrap").length).toBe(1);
  });

  it("creates a scrap stack if there isn't one", () => {
    const x = Fixtures.doc("<save><hostInventory></hostInventory></save>");
    Model.setScrap(x, 25);
    expect(Model.getScrap(x)).toBe(25);
  });

  it("puts item codes in sensible categories", () => {
    expect(Model.itemCategory("ITM_Equip_Weapon_SniperRifle_Tier6-1_SR2000Argent")).toBe("Weapons");
    expect(Model.itemCategory("ITM_Equip_Armor_Helmet_Light_Tier6-1_RangerHelmet")).toBe("Armor");
    expect(Model.itemCategory("ITM_Consumable_Healing_MedicPack")).toBe("Consumables");
    expect(Model.itemCategory("Ammo556mm")).toBe("Ammo");
    expect(Model.itemCategory("ITM_Scrap")).toBe("Crafting");
    expect(Model.itemCategory("ITM_VehicleHood_WolfSkull")).toBe("Kodiak");
    expect(Model.itemCategory("ITM_Something_Odd")).toBe("Other");
  });
});

describe("Squad", () => {
  beforeEach(() => { d = Fixtures.doc(); });

  it("names custom rangers and companions", () => {
    expect(Model.pcName(pcAt(0))).toBe("Zoë & Co");
    expect(Model.pcName(pcAt(1))).toBe("Lucia Wesson");
  });

  it("sets all attributes at once", () => {
    expect(Model.setAllAttributes(pcAt(0), 10)).toBe(5);
    for (const a of Model.ATTRIBUTES) expect(text(pcAt(0), a)).toBe("10");
  });

  it("changes and adds skills", () => {
    Model.setSkill(pcAt(0), "80", 10);
    expect(text(Model.findSkill(pcAt(0), "80"), "level")).toBe("10");
    Model.setSkill(pcAt(0), Model.COMBAT_SHOOTING, 1);
    expect(text(Model.findSkill(pcAt(0), "570"), "level")).toBe("1");
  });

  it("adds a perk's ability along with the perk", () => {
    const r = Model.addPerk(pcAt(0), "PRK_Leadership_Rally");
    expect(r).toEqual({ added: true, ability: "ABL_Leadership_Rally" });
    expect(Model.hasAbility(pcAt(0), "ABL_Leadership_Rally")).toBeTruthy();
  });

  it("removes the ability when the perk is removed", () => {
    Model.addPerk(pcAt(0), "PRK_Leadership_Rally");
    expect(Model.removePerk(pcAt(0), "PRK_Leadership_Rally")).toEqual({ removed: true, ability: "ABL_Leadership_Rally" });
    expect(Model.hasAbility(pcAt(0), "ABL_Leadership_Rally")).toBeFalsy();
  });

  it("doesn't add a perk twice", () => {
    expect(Model.addPerk(pcAt(0), "PRK_Generic_Healthy").added).toBeFalsy();
  });

  it("leaves an existing ability alone when adding its perk", () => {
    expect(Model.addPerk(pcAt(0), "PRK_Generic_Hardened").ability).toBe(null);
  });

  it("sets and clears the quirk", () => {
    Model.setSinglePerk(pcAt(0), "QRK_", "QRK_LoneWolf");
    expect(Model.hasPerk(pcAt(0), "QRK_LoneWolf")).toBeTruthy();
    expect(Model.hasPerk(pcAt(0), "QRK_None")).toBeFalsy();
    Model.setSinglePerk(pcAt(0), "QRK_", "");
    expect([...pcAt(0).querySelectorAll("perkname")].some(p => p.textContent.startsWith("QRK_"))).toBeFalsy();
  });

  it("adds a background to someone without one", () => {
    const x = Fixtures.doc("<save><pcs><pc></pc></pcs></save>");
    Model.setSinglePerk(Model.pcs(x)[0], "BCK_", "BCK_Academic");
    expect(Model.hasPerk(Model.pcs(x)[0], "BCK_Academic")).toBeTruthy();
  });

  it("adds and removes mutations in the same format as the game", () => {
    expect(Model.addStatusEffect(pcAt(0), "EFF_Radiation_ThirdEye")).toBeTruthy();
    const last = pcAt(0).querySelector("statusEffects").lastElementChild;
    expect(SaveFile.serialize(last, false)).toBe("<statusEffect><name>EFF_Radiation_ThirdEye</name><turnsRemaining>1</turnsRemaining></statusEffect>");
    expect(Model.addStatusEffect(pcAt(0), "EFF_Radiation_ThirdEye")).toBeFalsy();
    expect(Model.removeStatusEffect(pcAt(0), "EFF_Radiation_ThirdEye")).toBeTruthy();
    expect(Model.hasStatusEffect(pcAt(0), "EFF_Radiation_ThirdEye")).toBeFalsy();
  });
});

describe("Equipment", () => {
  beforeEach(() => { d = Fixtures.doc(); });
  const inv = () => [...d.querySelectorAll("hostInventory > item")];
  const find = code => inv().find(i => text(i, "templateName") === code);

  it("swaps a weapon in, taking one from a stack and returning the old one", () => {
    const pc = pcAt(0);
    const stack = find("ITM_Equip_Weapon_SniperRifle_Tier3-1_PerkeleModel85");
    const it = Model.equip(pc, 1, stack);
    expect(text(Model.equipped(pc, 1), "templateName")).toBe("ITM_Equip_Weapon_SniperRifle_Tier3-1_PerkeleModel85");
    expect(text(it, "quantity")).toBe("1");
    expect(text(stack, "quantity")).toBe("1");
    expect(text(it, "uid") === text(stack, "uid")).toBeFalsy();
    const back = find("ITM_Equip_Weapon_SniperRifle_Tier6-1_SR2000Argent");
    expect(text(back, "slot")).toBe("0");
  });

  it("moves a single item rather than copying it", () => {
    const pc = pcAt(0);
    const helmet = find("ITM_Equip_Armor_Helmet_Light_Tier6-1_RangerHelmet");
    Model.equip(pc, 28, helmet);
    expect(find("ITM_Equip_Armor_Helmet_Light_Tier6-1_RangerHelmet")).toBe(undefined);
    expect(text(Model.equipped(pc, 28), "slot")).toBe("28");
  });

  it("equips a new item that wasn't in the inventory", () => {
    const pc = pcAt(0);
    const it = Model.equipNew(pc, 1, "ITM_Equip_Weapon_SniperRifle_Tier1-1_SlagSniper");
    expect(Model.equipped(pc, 1)).toBe(it);
    expect(text(it, "quantity")).toBe("1");
    expect(text(find("ITM_Equip_Weapon_SniperRifle_Tier6-1_SR2000Argent"), "slot")).toBe("0");
    expect(() => Model.equipNew(pc, 28, "ITM_Scrap")).toThrow(/can't go in the Helmet slot/);
  });

  it("refuses items that don't fit the slot", () => {
    expect(() => Model.equip(pcAt(0), 28, find("ITM_Consumable_Healing_MedicPack"))).toThrow(/can't go in the Helmet slot/);
  });

  it("unequips into the inventory", () => {
    Model.unequip(pcAt(0), 3);
    expect(Model.equipped(pcAt(0), 3)).toBe(null);
    expect(text(inv()[0], "templateName")).toBe("ITM_Equip_Armor_Chest_Light_Tier6-1_RangerArmor");
  });

  it("offers outfit pieces for the same body part and body type", () => {
    const chest = Model.equipped(pcAt(0), 5);
    const options = Model.outfitOptions(pcAt(0), chest);
    expect(options.length).toBeGreaterThan(10);
    for (const c of options) {
      expect(c.includes("_Female_")).toBeFalsy();
      expect(c.split("_").includes("Chest")).toBeTruthy();
    }
    expect(Model.outfitOptions(pcAt(0), Model.equipped(pcAt(0), 23))).toBe(null);
  });

  it("labels slots", () => {
    expect(Model.slotLabel(1)).toBe("Primary weapon");
    expect(Model.slotLabel("23")).toBe("Quick slot 1");
    expect(Model.slotLabel(99)).toBe("Slot 99");
  });
});

describe("Vehicles", () => {
  beforeEach(() => { d = Fixtures.doc(); });

  it("finds the Kodiak and its slots", () => {
    expect(Model.carName(Model.cars(d)[0], 0)).toBe("Kodiak");
    expect(Model.vehicleSlot(18).label).toBe("Armor");
    expect(Model.vehicleSlot(18).accepts.test("ITM_VehicleArmor_HeavyArmorPlating")).toBeTruthy();
    expect(Model.vehicleSlot(77).label).toBe("Slot 77");
  });
});

describe("Collectibles", () => {
  beforeEach(() => { d = Fixtures.doc(); });
  const def = key => Model.COLLECTIONS.find(c => c.key === key);

  it("reads comma lists and element lists", () => {
    expect(Model.getCollection(d, def("appearances"))).toEqual(["Scientist_Male_Chest", "RangerN_Male_Chest"]);
    expect(Model.getCollection(d, def("creepydolls"))).toEqual(["ITM_CreepyDoll_Zoophiliac"]);
  });

  it("adds to a comma list without duplicates", () => {
    expect(Model.addToCollection(d, def("vehicleParts"), ["ITM_VehicleHood_WolfSkull", "ITM_VehicleHood_Dragon"])).toBe(1);
    expect(text(d.documentElement, "vehicleParts")).toBe("ITM_VehicleHood_WolfSkull,ITM_VehicleHorn_Police,ITM_VehicleHood_Dragon");
  });

  it("adds to an element list as new elements", () => {
    Model.addToCollection(d, def("cassettetapes"), "ITM_CassetteTape_X_ElevenMile_HoonDiary");
    expect(SaveFile.serialize(d.querySelector("cassettetapes"), false)).toBe("<cassettetapes><cassettetape>ITM_CassetteTape_B_Denver_ANewWell</cassettetape><cassettetape>ITM_CassetteTape_X_ElevenMile_HoonDiary</cassettetape></cassettetapes>");
  });

  it("removes entries", () => {
    expect(Model.removeFromCollection(d, def("creepydolls"), "ITM_CreepyDoll_Zoophiliac")).toBeTruthy();
    expect(Model.getCollection(d, def("creepydolls"))).toEqual([]);
    expect(Model.removeFromCollection(d, def("creepydolls"), "ITM_CreepyDoll_Zoophiliac")).toBeFalsy();
  });

  it("handles an empty comma list", () => {
    expect(Model.getCollection(d, def("craftedRecipes"))).toEqual([]);
    Model.addToCollection(d, def("craftedRecipes"), "ITM_Crafting_Recipe_Junk_DogShit");
    expect(text(d.documentElement, "craftedRecipes")).toBe("ITM_Crafting_Recipe_Junk_DogShit");
  });

  it("lists what's missing from every collection", () => {
    for (const c of Model.COLLECTIONS) {
      const missing = Model.missingFromCollection(d, c);
      expect(missing.length).toBeGreaterThan(0);
      for (const have of Model.getCollection(d, c)) expect(missing.includes(have)).toBeFalsy();
    }
  });
});

describe("Character export and import", () => {
  beforeEach(() => { d = Fixtures.doc(); });

  it("round-trips a character into another slot", () => {
    const json = Model.exportCharacter(pcAt(0));
    const target = pcAt(1);
    const pos = SaveFile.serialize(child(target, "position"), false);
    const { pc, warnings } = Model.importCharacter(d, json, target);
    expect(Model.pcs(d).length).toBe(2);
    expect(Model.pcs(d)[1]).toBe(pc);
    expect(Model.pcName(pc)).toBe("Zoë & Co");
    expect(SaveFile.serialize(child(pc, "position"), false)).toBe(pos);
    expect(warnings).toEqual([]);
  });

  it("keeps the target's position even when the import has none", () => {
    const json = JSON.parse(Model.exportCharacter(pcAt(0)));
    const target = pcAt(1);
    const pos = SaveFile.serialize(child(target, "position"), false);
    const xml = new DOMParser().parseFromString(json.xml, "application/xml");
    for (const t of ["position", "rotation"]) { const n = xml.documentElement.querySelector(":scope > " + t); if (n) n.remove(); }
    json.xml = SaveFile.serialize(xml, false);
    const { pc } = Model.importCharacter(d, JSON.stringify(json), target);
    expect(SaveFile.serialize(child(pc, "position"), false)).toBe(pos);
  });

  it("gives imported gear new uids", () => {
    const json = Model.exportCharacter(pcAt(0));
    const { pc } = Model.importCharacter(d, json, pcAt(1));
    const before = [...pcAt(0).querySelectorAll("equipment uid")].map(u => u.textContent);
    for (const u of pc.querySelectorAll("equipment uid")) expect(before.includes(u.textContent)).toBeFalsy();
  });

  it("warns about importing a story companion", () => {
    const json = Model.exportCharacter(pcAt(1));
    expect(Model.importCharacter(d, json, pcAt(1)).warnings.length).toBe(1);
  });

  it("won't put the same companion in the squad twice", () => {
    const json = Model.exportCharacter(pcAt(1));
    const before = SaveFile.serialize(d, false);
    expect(() => Model.importCharacter(d, json, pcAt(0))).toThrow(/already in this squad/);
    expect(SaveFile.serialize(d, false)).toBe(before);
  });

  it("rejects an empty or incomplete character without changing anything", () => {
    const before = SaveFile.serialize(d, false);
    const empty = JSON.stringify({ format: "wasteland3-save-editor/character", xml: "<pc/>" });
    expect(() => Model.importCharacter(d, empty, pcAt(0))).toThrow(/incomplete/);
    expect(SaveFile.serialize(d, false)).toBe(before);
  });

  it("keeps every piece of gear and the rotation on import", () => {
    const json = Model.exportCharacter(pcAt(0));
    const target = pcAt(1);
    const rotation = text(target, "rotation");
    const { pc } = Model.importCharacter(d, json, target);
    expect(pc.querySelectorAll("equipment > item").length).toBe(4);
    expect(text(pc, "rotation")).toBe(rotation);
    const uids = [...d.querySelectorAll("uid")].map(u => u.textContent);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it("lists warnings before anything is replaced", () => {
    const json = Model.exportCharacter(pcAt(1));
    const before = SaveFile.serialize(d, false);
    const check = Model.checkImport(d, json, pcAt(1));
    expect(check.name).toBe("Lucia Wesson");
    expect(check.warnings.length).toBe(1);
    expect(SaveFile.serialize(d, false)).toBe(before);
  });

  it("rejects files that aren't exports", () => {
    expect(() => Model.importCharacter(d, "not json", pcAt(0))).toThrow(/isn't a character export/);
    expect(() => Model.importCharacter(d, '{"format":"other"}', pcAt(0))).toThrow(/isn't a character export/);
    expect(() => Model.importCharacter(d, JSON.stringify({ format: "wasteland3-save-editor/character", xml: "<nope>" }), pcAt(0))).toThrow(/damaged/);
  });
});

describe("Limits that keep saves loadable", () => {
  beforeEach(() => { d = Fixtures.doc(); });

  it("keeps numbers within 32-bit whole numbers", () => {
    expect(Model.clampInt(1e23)).toBe("2147483647");
    expect(Model.clampInt(-1e23)).toBe("-2147483648");
    expect(Model.clampInt("12.7")).toBe("12");
    expect(Model.clampInt("abc", 1)).toBe("1");
    expect(text(Model.addInventoryItem(d, "ITM_Scrap", 1e23), "quantity")).toBe("2147483647");
    Model.setScrap(d, 1e23);
    expect(Model.getScrap(d)).toBe(2147483647);
  });

  it("never offers recipes for gear slots", () => {
    for (const def of Model.GEAR_SLOTS) {
      const accepted = metaData.Items.filter(c => def.accepts.test(c));
      expect(accepted.length).toBeGreaterThan(0);
      expect(accepted.filter(c => /Recipe/.test(c))).toEqual([]);
    }
  });

  it("only offers player turrets for the Kodiak turret", () => {
    const turrets = metaData.Items.filter(c => Model.vehicleSlot(1).accepts.test(c));
    expect(turrets.includes("ITM_Vehicle_Turret_PatriotBlaster")).toBeTruthy();
    expect(turrets.filter(c => /VehicleWeapon|_Npc|AmbushSite|WarBot|PatriarchTank/.test(c))).toEqual([]);
  });

  it("refuses the wrong part for a Kodiak slot", () => {
    const armor = [...d.querySelectorAll("cars item")].find(i => text(i, "slot") === "18");
    expect(() => Model.setVehiclePart(armor, "ITM_VehicleHood_WolfSkull")).toThrow(/can't go in the Armor slot/);
    Model.setVehiclePart(armor, "ITM_VehicleArmor_AlloyArmorPlating");
    expect(text(armor, "templateName")).toBe("ITM_VehicleArmor_AlloyArmorPlating");
  });

  it("only offers headwear for the headwear outfit slot", () => {
    const pc = pcAt(0);
    const it = Model.makeItem(d, "Mask_Male_02", 1);
    setText(it, "slot", 11);
    pc.querySelector("equipment").append(it);
    const options = Model.outfitOptions(pc, it);
    expect(options.length).toBeGreaterThan(0);
    for (const c of options) expect(c.split("_").includes("Helmet")).toBeTruthy();
  });

  it("recognises test, deprecated and NPC-only codes", () => {
    expect(Model.isDevCode("ITM_CassetteTape_Test1")).toBeTruthy();
    expect(Model.isDevCode("ITM_Vehicle_Turret_Payaso_Npc")).toBeTruthy();
    expect(Model.isDevCode("EFF_TEST_StatusEffectTester")).toBeTruthy();
    expect(Model.isDevCode("ITM_Consumable_Healing_MedicPack")).toBeFalsy();
    for (const def of Model.COLLECTIONS.filter(c => c.key !== "appearances")) expect(def.all().filter(Model.isDevCode)).toEqual([]);
  });

  it("treats crafting recipes as recipes, and crafting history as history", () => {
    const recipes = Model.COLLECTIONS.find(c => c.key === "recipes");
    const history = Model.COLLECTIONS.find(c => c.key === "craftedRecipes");
    expect(Model.collectionFor("ITM_Crafting_Recipe_Junk_DogShit")).toBe(recipes);
    Model.addToCollection(d, history, "ITM_Crafting_Recipe_Junk_DogShit");
    expect(Model.getCollection(d, recipes).includes("ITM_Crafting_Recipe_Junk_DogShit")).toBeTruthy();
  });

  it("keeps an ability the character already had when a perk is removed", () => {
    const pc = pcAt(0);
    Model.addAbility(pc, "ABL_Leadership_Rally");
    const r = Model.addPerk(pc, "PRK_Leadership_Rally");
    expect(r.ability).toBe(null);
    Model.removePerk(pc, "PRK_Leadership_Rally");
    expect(Model.hasAbility(pc, "ABL_Leadership_Rally")).toBeTruthy();
    expect(Model.abilities(pc).filter(a => a.textContent === "ABL_Leadership_Rally").length).toBe(1);
  });
});

describe("Stacks", () => {
  const count = (doc, code) => [...doc.querySelectorAll("hostInventory > item")].filter(i => text(i, "templateName") === code);

  it("adds consumables, ammo and scrap as one stack", () => {
    const doc = Fixtures.doc();
    Model.addInventoryItem(doc, "ITM_Consumable_Healing_MedHypo", 6);
    expect(count(doc, "ITM_Consumable_Healing_MedHypo").map(i => text(i, "quantity"))).toEqual(["6"]);
  });

  it("adds gear as one item per copy, each with its own uid", () => {
    const doc = Fixtures.doc();
    const code = "ITM_Equip_Armor_Helmet_Light_Tier2-1_Merc";
    Model.addInventoryItem(doc, code, 6);
    const items = count(doc, code);
    expect(items.length).toBe(6);
    expect(items.every(i => text(i, "quantity") === "1")).toBeTruthy();
    expect(new Set(items.map(i => text(i, "uid"))).size).toBe(6);
  });

  it("caps copies of things that don't stack", () => {
    const doc = Fixtures.doc();
    Model.addInventoryItem(doc, "ITM_WeaponMod_Ranged_Scope_Tier2-1", 1000);
    expect(count(doc, "ITM_WeaponMod_Ranged_Scope_Tier2-1").length).toBe(Model.MAX_COPIES);
  });

  it("treats ammo as stackable, even though its codes have no ITM_ prefix", () => {
    expect(Model.isStackable("Ammo9mm")).toBeTruthy();
    expect(Model.isStackable("ITM_SkillBook_CombatShooting")).toBeFalsy();
  });

  it("splits a stack of gear into separate items", () => {
    const doc = Fixtures.doc();
    const code = "ITM_Equip_Armor_Helmet_Light_Tier2-1_Merc";
    const item = Model.addInventoryItem(doc, code, 1);
    setText(item, "quantity", 3);
    expect(Model.splitStack(item)).toBe(3);
    const items = count(doc, code);
    expect(items.length).toBe(3);
    expect(items.every(i => text(i, "quantity") === "1")).toBeTruthy();
    expect(new Set(items.map(i => text(i, "uid"))).size).toBe(3);
  });

  it("lists ammo so it can be added", () => {
    expect(metaData.Items).toContain("AmmoRocket");
    expect(Model.isInventoryCode("AmmoRocket")).toBeTruthy();
  });

  it("splits big stacks a hundred at a time without losing any", () => {
    const doc = Fixtures.doc();
    const code = "ITM_Equip_Armor_Helmet_Light_Tier2-1_Merc";
    const item = Model.addInventoryItem(doc, code, 1);
    setText(item, "quantity", 250);
    expect(Model.splitStack(item)).toBe(Model.MAX_COPIES);
    const total = count(doc, code).reduce((n, i) => n + +text(i, "quantity"), 0);
    expect(total).toBe(250);
  });

  it("stacks crafted consumables", () => {
    expect(Model.isStackable("ITM_Crafting_Consumable_Alcohol_SuperSqueezins")).toBeTruthy();
  });

  it("clamps infinite numbers to the limit", () => {
    expect(Model.clampInt("1e999")).toBe(String(Model.INT_MAX));
    expect(Model.clampInt(-Infinity, 0)).toBe("0");
  });
});
