// Reading and changing the save's XML: squad, inventory, collectibles, diffs.
"use strict";

const Model = (() => {
  const rootOf = doc => doc.documentElement;
  const ensure = (node, tag) => child(node, tag) || node.appendChild(newEl(node.ownerDocument, tag));

  // Story flags ("globals": <global><k>name</k><v>value</v></global>)
  function globalsEl(doc) { return ensure(rootOf(doc), "globals"); }
  function findGlobal(doc, k) {
    for (const g of children(child(rootOf(doc), "globals"), "global")) if (text(g, "k") === k) return g;
    return null;
  }
  function getGlobal(doc, k) { const g = findGlobal(doc, k); return g ? text(g, "v") : undefined; }
  function setGlobal(doc, k, v) {
    let g = findGlobal(doc, k);
    if (!g) {
      g = newEl(doc, "global");
      g.append(newEl(doc, "k", k), newEl(doc, "v", v));
      globalsEl(doc).append(g);
      return true;
    }
    return setText(g, "v", v);
  }
  function deleteGlobal(doc, k) { const g = findGlobal(doc, k); if (g) g.remove(); return !!g; }
  function listGlobals(doc) {
    return children(child(rootOf(doc), "globals"), "global").map(node => ({ k: text(node, "k"), v: text(node, "v"), node }));
  }

  const PARTY_STATS = [
    { key: "G_Fame", label: "Fame" },
    { key: "G_RangerAllegiance", label: "Ranger allegiance" },
  ];
  function reputations(doc) {
    return listGlobals(doc)
      .filter(g => /^G_Reputation_/.test(g.k) && !/^G_Reputation_Changed_/.test(g.k))
      .map(g => ({ ...g, label: displayName(g.k.replace(/^G_Reputation_/, "")) }));
  }

  // Items
  const ITEM_CODE = /^[A-Za-z0-9_\-]+$/;
  // The game stores numbers as 32-bit integers.
  const INT_MAX = 2147483647, INT_MIN = -2147483648;
  function clampInt(n, min = INT_MIN, max = INT_MAX) {
    n = Math.trunc(Number(n));
    if (!Number.isFinite(n)) n = min > 0 ? min : 0;
    return String(Math.min(max, Math.max(min, n)));
  }

  function makeItem(doc, code, qty = 1) {
    qty = clampInt(qty, 1);
    const it = newEl(doc, "item");
    it.append(
      newEl(doc, "templateName", code), newEl(doc, "slot", 0), newEl(doc, "ammoLoaded", 0),
      newEl(doc, "quantity", qty), newEl(doc, "uid", uuid()),
      newEl(doc, "isLockedForMerchant", "False"), newEl(doc, "merchantBarterLevelRequirement", 0));
    return it;
  }
  function inventory(doc) { return ensure(rootOf(doc), "hostInventory"); }
  // Only these come in stacks. Gear, mods, keys and quest items are one per
  // item in real saves, even with several of the same thing.
  const STACKABLE = /^(ITM_)?(DLC\d_)?(Consumable|CraftingComponent|Ammo|Junk|Scrap$)/;
  const isStackable = code => STACKABLE.test(code);
  const MAX_COPIES = 100;

  // Adds a stack, or for things that don't stack, one item per copy (up to
  // MAX_COPIES). Returns the first item added.
  function addInventoryItem(doc, code, qty = 1) {
    if (!ITEM_CODE.test(code)) throw new Error("Not a valid item code: " + code);
    if (isOutfitItem(code)) throw new Error(`${displayName(code)} is an outfit, which the game doesn't keep in the inventory. Unlock it under Collectibles instead.`);
    const inv = inventory(doc);
    const copies = isStackable(code) ? 1 : Math.min(MAX_COPIES, +clampInt(qty, 1));
    let first = null;
    for (let i = 0; i < copies; i++) {
      const item = makeItem(doc, code, isStackable(code) ? qty : 1);
      inv.insertBefore(item, inv.firstElementChild);
      first = item;
    }
    return first;
  }
  // Turns a stack of something that doesn't stack into separate items.
  function splitStack(item) {
    const qty = Math.min(MAX_COPIES, parseInt(text(item, "quantity"), 10) || 1);
    setText(item, "quantity", 1);
    for (let i = 1; i < qty; i++) duplicateItem(item);
    return qty;
  }
  function duplicateItem(it) {
    const copy = it.cloneNode(true);
    setText(copy, "uid", uuid());
    it.after(copy);
    return copy;
  }

  // Scrap is just an ITM_Scrap stack in the shared inventory.
  function scrapStacks(doc) { return children(child(rootOf(doc), "hostInventory"), "item").filter(i => text(i, "templateName") === "ITM_Scrap"); }
  function getScrap(doc) { return scrapStacks(doc).reduce((n, i) => n + (parseInt(text(i, "quantity"), 10) || 0), 0); }
  function setScrap(doc, n) {
    n = +clampInt(n, 0);
    const stacks = scrapStacks(doc);
    if (!stacks.length) { if (n > 0) addInventoryItem(doc, "ITM_Scrap", n); return; }
    setText(stacks[0], "quantity", n);
    for (const s of stacks.slice(1)) s.remove();
  }

  // Outfits (ITM_Appearance_*) aren't inventory items. Owning one means its
  // pieces are in <appearances>. Elf, Santa and Gorilla Suit checked in a real save.
  const OUTFIT_PIECE_PREFIX = {
    ITM_Appearance_BearSuit: "BearSuit_",
    ITM_Appearance_CommonerOutfit: "Commoner_",
    ITM_Appearance_ElfOutfit: "Elf_",
    ITM_Appearance_GorillaSuit: "GorillaSuit_",
    ITM_Appearance_SantaOufit: "Santa_",
    ITM_Appearance_ScientistOutfit: "Scientist_",
  };
  const isOutfitItem = code => /^ITM_Appearance_/.test(code);
  // Test, deprecated and NPC-only codes the game files contain but players
  // shouldn't be given.
  const DEV_CODE = /(^|_)(Test|TEST)(\d|_|$)|DEPRECATED|Deprecated|_Npc(_|$)/;
  const isDevCode = code => DEV_CODE.test(code);
  function outfitPieces(code) {
    const prefix = OUTFIT_PIECE_PREFIX[code];
    return prefix ? metaData.Outfits.filter(c => c.startsWith(prefix)) : [];
  }
  // Returns how many pieces were new, or null if the pieces aren't known.
  function unlockOutfit(doc, code) {
    const pieces = outfitPieces(code);
    if (!pieces.length) return null;
    return addToCollection(doc, collection("appearances"), pieces);
  }

  const ITEM_CATEGORIES = [
    ["Weapons", /(^|_)Equip_Weapon_|_Weapon_/],
    ["Armor", /Equip_Armor_/],
    ["Trinkets", /Equip_(Trinket|WeirdScience)/],
    ["Consumables", /Consumable_/],
    ["Ammo", /^(ITM_)?Ammo/],
    ["Mods", /(Weapon|Armor)Mod_/],
    ["Kodiak", /^ITM_Vehicle/],
    ["Crafting", /Crafting|Recipe|^ITM_Scrap$/],
    ["Collectibles", /CassetteTape|CreepyDoll|Lorebook|SkillBook/],
  ];
  function itemCategory(code) {
    for (const [name, re] of ITEM_CATEGORIES) if (re.test(code)) return name;
    return "Other";
  }

  // Squad
  const ATTRIBUTES = ["coordination", "luck", "awareness", "strength", "speed", "intelligence", "charisma"];
  const SKILLS = {}; // id -> name
  for (const [name, id] of Object.entries(metaData.Skills)) SKILLS[id] = name;
  const COMBAT_SHOOTING = "570";

  function pcs(doc) { return children(child(rootOf(doc), "pcs"), "pc"); }
  function pcName(pc, i) {
    const custom = text(pc, "displayName");
    if (custom) return custom;
    const bck = children(child(pc, "perks"), "perk").map(p => text(p, "perkname")).find(n => n.startsWith("BCK_"));
    // Companions are named after their background code (BCK_LuciaWesson).
    if (bck && text(pc, "companionId") !== "-1") return prettyCode(bck);
    return "Ranger " + ((i === undefined ? pcs(pc.ownerDocument).indexOf(pc) : i) + 1);
  }
  function setAllAttributes(pc, value) {
    let n = 0;
    for (const a of ATTRIBUTES) if (setText(pc, a, value)) n++;
    return n;
  }
  function findSkill(pc, id) { return children(child(pc, "skills"), "skill").find(s => text(s, "skillId") === String(id)) || null; }
  function setSkill(pc, id, level) {
    let s = findSkill(pc, id);
    if (!s) {
      const doc = pc.ownerDocument;
      s = newEl(doc, "skill");
      s.append(newEl(doc, "skillId", id), newEl(doc, "level", level));
      ensure(pc, "skills").append(s);
      return true;
    }
    return setText(s, "level", level);
  }

  // Perks whose ability the game grants when the perk is picked in game, so it
  // has to be added alongside. The first 9 are from a real save; the rest
  // follow the same naming.
  const PERK_ABILITIES = {
    PRK_SniperRifles_MarkTarget: "ABL_MarkTarget",
    PRK_BigGuns_SuppressingFire: "ABL_HMG_SuppressingFire",
    PRK_Explosives_MortarBlast: "ABL_RocketLauncher_MortarBlast",
    PRK_SmallArms_TrickShot: "ABL_Handgun_TrickShot",
    PRK_WeirdScience_Overcharge: "ABL_Energy_Overcharge",
    PRK_AutomaticWeapons_PuncturingShot: "ABL_AssaultRifle_PuncturingShot",
    PRK_AutomaticWeapons_SprayNPray: "ABL_SMG_SprayNPray",
    PRK_Leadership_Demoralize: "ABL_Leadership_Demoralize",
    PRK_Leadership_Rally: "ABL_Leadership_Rally",
    PRK_BigGuns_PressureCooker: "ABL_Flamethrower_PressureCooker",
    PRK_Brawling_ShaolinSurprise: "ABL_Brawling_ShaolinSurprise",
    PRK_MeleeCombat_BleedingStrike: "ABL_Bladed_BleedingStrike",
    PRK_MeleeCombat_HackNSlash: "ABL_MeleeCombat_HackNSlash",
    PRK_MeleeCombat_StunningBlow: "ABL_Blunt_StunningBlow",
    PRK_SmallArms_ShredderShot: "ABL_Shotgun_ShredderShot",
    PRK_WeirdScience_ConductiveBeams: "ABL_Hazard_ConductiveBeams",
  };

  function perkNodes(pc) { return children(child(pc, "perks"), "perk"); }
  function hasPerk(pc, code) { return perkNodes(pc).some(p => text(p, "perkname") === code); }
  function abilities(pc) { return children(child(pc, "abilities"), "ability"); }
  function hasAbility(pc, code) { return abilities(pc).some(a => a.textContent === code); }
  function addAbility(pc, code) {
    if (hasAbility(pc, code)) return false;
    ensure(pc, "abilities").append(newEl(pc.ownerDocument, "ability", code));
    return true;
  }
  function removeAbility(pc, code) {
    const a = abilities(pc).find(x => x.textContent === code);
    if (a) a.remove();
    return !!a;
  }
  // Removing a perk only removes an ability that was added with it here.
  const abilitiesAddedWithPerk = new WeakMap();
  function addPerk(pc, code) {
    if (hasPerk(pc, code)) return { added: false, ability: null };
    const doc = pc.ownerDocument;
    const p = newEl(doc, "perk");
    p.append(newEl(doc, "perkname", code));
    ensure(pc, "perks").append(p);
    const abl = PERK_ABILITIES[code];
    if (abl && addAbility(pc, abl)) {
      if (!abilitiesAddedWithPerk.has(pc)) abilitiesAddedWithPerk.set(pc, new Set());
      abilitiesAddedWithPerk.get(pc).add(abl);
      return { added: true, ability: abl };
    }
    return { added: true, ability: null };
  }
  function removePerk(pc, code) {
    const p = perkNodes(pc).find(x => text(x, "perkname") === code);
    if (!p) return { removed: false, ability: null };
    p.remove();
    const abl = PERK_ABILITIES[code];
    const ours = abilitiesAddedWithPerk.get(pc);
    // Not forgotten here, so undo then remove again still takes the ability.
    if (abl && ours && ours.has(abl)) {
      return { removed: true, ability: removeAbility(pc, abl) ? abl : null };
    }
    return { removed: true, ability: null };
  }
  // Background (BCK_) and quirk (QRK_) are perks too; there is one of each.
  function setSinglePerk(pc, prefix, code) {
    const current = perkNodes(pc).find(p => text(p, "perkname").startsWith(prefix));
    if (current && code) return setText(current, "perkname", code);
    if (current) { current.remove(); return true; }
    if (code) return addPerk(pc, code).added;
    return false;
  }

  // Status effects & mutations
  const MUTATIONS = [
    { code: "EFF_Radiation_AnimalReflexes", name: "Animal Reflexes", effect: "+5% evasion", good: true },
    { code: "EFF_Radiation_ChromaticSkin", name: "Chromatic Skin", effect: "+1s detection time", good: true },
    { code: "EFF_Radiation_ExtraElbow", name: "Extra Elbow", effect: "+25% throwing range", good: true },
    { code: "EFF_Radiation_FleshPocket", name: "Flesh Pocket", effect: "+1 quick slot", good: true },
    { code: "EFF_Radiation_HardenedSkeleton", name: "Hardened Skeleton", effect: "+4 armor", good: true },
    { code: "EFF_Radiation_HyperIntelligence", name: "Hyper-Intelligence", effect: "+5% XP", good: true },
    { code: "EFF_Radiation_ScaleSkin", name: "Scale Skin", effect: "+10% status resistance", good: true },
    { code: "EFF_Radiation_ThirdEye", name: "Third Eye", effect: "+5% crit chance", good: true },
    { code: "EFF_Radiation_WebbedToes", name: "Webbed Toes", effect: "+0.5 combat speed", good: true },
    { code: "EFF_Radiation_Nausea", name: "Nausea", effect: "-1 AP", good: false },
    { code: "EFF_Radiation_Shakes", name: "Shakes", effect: "-10% hit chance", good: false },
    { code: "EFF_Radiation_Weakness", name: "Weakness", effect: "-15% CON", good: false },
  ];
  function statusEffects(pc) { return children(child(pc, "statusEffects"), "statusEffect"); }
  function hasStatusEffect(pc, code) { return statusEffects(pc).some(s => text(s, "name") === code); }
  // turnsRemaining 1 matches how permanent mutations appear in real saves.
  function addStatusEffect(pc, code, turns = 1) {
    if (hasStatusEffect(pc, code)) return false;
    const doc = pc.ownerDocument;
    const s = newEl(doc, "statusEffect");
    s.append(newEl(doc, "name", code), newEl(doc, "turnsRemaining", turns));
    ensure(pc, "statusEffects").append(s);
    return true;
  }
  function removeStatusEffect(pc, code) {
    const s = statusEffects(pc).find(x => text(x, "name") === code);
    if (s) s.remove();
    return !!s;
  }

  // Equipment
  // Real gear codes start ITM_, ITM_DLCn_ or ITM_Crafting_ (crafted gear).
  // Recipes (…_Recipe_Equip_…) have the same names but aren't gear.
  const gear = kind => new RegExp(`^ITM_(DLC\\d_)?(Crafting_|Crafing_)?Equip_${kind}`);
  const GEAR_SLOTS = [
    { slot: 1, label: "Primary weapon", accepts: gear("Weapon_") },
    { slot: 2, label: "Secondary weapon", accepts: gear("Weapon_") },
    { slot: 28, label: "Helmet", accepts: gear("Armor_Helmet") },
    { slot: 3, label: "Body armor", accepts: gear("Armor_Chest") },
    { slot: 26, label: "Leg armor", accepts: gear("Armor_Legs") },
    { slot: 4, label: "Trinket / Weird Science", accepts: gear("(Trinket|WeirdScience)_") },
  ];
  const OTHER_SLOTS = {
    5: "Outfit (chest)", 6: "Outfit (legs)", 11: "Outfit (headwear)", 12: "Head", 13: "Hair", 14: "Facial hair / face",
    23: "Quick slot 1", 24: "Quick slot 2", 25: "Quick slot 3", 29: "Quick slot 4",
  };
  function slotLabel(slot) {
    const g = GEAR_SLOTS.find(s => s.slot === +slot);
    return g ? g.label : OTHER_SLOTS[slot] || "Slot " + slot;
  }
  function equipped(pc, slot) { return children(child(pc, "equipment"), "item").find(i => text(i, "slot") === String(slot)) || null; }
  function moveToInventory(doc, it) {
    setText(it, "slot", 0);
    const inv = inventory(doc);
    inv.insertBefore(it, inv.firstElementChild);
  }
  function checkFitsSlot(slot, code) {
    const def = GEAR_SLOTS.find(s => s.slot === +slot);
    if (def && !def.accepts.test(code)) throw new Error(`${displayName(code)} can't go in the ${def.label} slot.`);
  }
  function putInSlot(pc, slot, item) {
    const current = equipped(pc, slot);
    if (current) moveToInventory(pc.ownerDocument, current);
    setText(item, "slot", slot);
    ensure(pc, "equipment").append(item);
    return item;
  }
  // Moves an item from the shared inventory into a gear slot; whatever was in
  // the slot goes back to the inventory. A stack gives up one item.
  function equip(pc, slot, invItem) {
    checkFitsSlot(slot, text(invItem, "templateName"));
    const qty = parseInt(text(invItem, "quantity"), 10) || 1;
    if (qty === 1) return putInSlot(pc, slot, invItem);
    setText(invItem, "quantity", qty - 1);
    const single = invItem.cloneNode(true);
    setText(single, "quantity", 1);
    setText(single, "uid", uuid());
    return putInSlot(pc, slot, single);
  }
  function equipNew(pc, slot, code) {
    checkFitsSlot(slot, code);
    return putInSlot(pc, slot, makeItem(pc.ownerDocument, code, 1));
  }
  // Outfit codes that could replace an outfit piece: same body part, same
  // body type (Male/Female) as what's worn now. null for slots we don't swap.
  const OUTFIT_PARTS = { 5: ["Chest"], 6: ["Legs"], 11: ["Helmet"] };
  function outfitOptions(pc, it) {
    const parts = OUTFIT_PARTS[text(it, "slot")];
    if (!parts) return null;
    const tokens = c => c.split("_");
    const bodyType = tokens(text(it, "templateName")).find(t => t === "Male" || t === "Female") ||
      children(child(pc, "equipment"), "item").map(i => tokens(text(i, "templateName")).find(t => t === "Male" || t === "Female")).find(Boolean);
    const partOf = c => tokens(c).find(t => /^(Chest|Legs|Helmet|Head|Hair|Beard|Feet|Hands|Eyes|Face)$/.test(t)) || null;
    return metaData.Outfits.filter(c => {
      if (isDevCode(c)) return false;
      const t = tokens(c);
      const g = t.find(x => x === "Male" || x === "Female");
      return (!g || !bodyType || g === bodyType) && parts.includes(partOf(c));
    });
  }

  function unequip(pc, slot) {
    const it = equipped(pc, slot);
    if (it) moveToInventory(pc.ownerDocument, it);
    return it;
  }

  // Vehicles
  // Player turrets are ITM_Vehicle_Turret_X with a matching ITM_VehicleWeapon_Turret_X
  // unlock. The rest are enemy turrets. VehicleWeapon codes are unlocks, not parts.
  const playerTurret = {
    test(code) {
      const m = /^ITM_Vehicle_Turret_(\w+)$/.exec(code);
      return !!m && metaData.Items.includes("ITM_VehicleWeapon_Turret_" + m[1]);
    },
  };
  const VEHICLE_SLOTS = {
    1: { label: "Turret", accepts: playerTurret },
    18: { label: "Armor", accepts: /^ITM_VehicleArmor_/ },
    19: { label: "Hood ornament", accepts: /^ITM_VehicleHood_/ },
    21: { label: "Horn", accepts: /^ITM_VehicleHorn_/ },
    31: { label: "Chassis", accepts: /^ITM_VehicleChassis_/ },
    32: { label: "Mortar", accepts: /^ITM_VehicleMortar_/ },
    33: { label: "AI module", accepts: /^ITM_VehicleAI_/ },
  };
  function vehicleSlot(slot) { return VEHICLE_SLOTS[slot] || { label: "Slot " + slot, accepts: /^ITM_Vehicle(?!Unlock|Weapon)/ }; }
  function setVehiclePart(it, code) {
    const def = vehicleSlot(text(it, "slot"));
    if (!def.accepts.test(code) || isDevCode(code)) throw new Error(`${displayName(code)} can't go in the ${def.label} slot.`);
    return setText(it, "templateName", code);
  }
  function cars(doc) { return children(child(rootOf(doc), "cars"), "car"); }
  function carName(car, i) { return text(car, "carType") === "0" ? "Kodiak" : `Vehicle ${i + 1} (type ${text(car, "carType")})`; }

  // Collectibles
  const collection = key => COLLECTIONS.find(c => c.key === key);
  const byPrefix = re => () => metaData.Items.filter(c => re.test(c) && !isDevCode(c));
  const COLLECTIONS = [
    { key: "cassettetapes", label: "Cassette tapes", kind: "list", itemTag: "cassettetape", all: byPrefix(/^ITM_CassetteTape_/) },
    { key: "creepydolls", label: "Creepy dolls", kind: "list", itemTag: "creepydoll", all: byPrefix(/^ITM_CreepyDoll_/) },
    { key: "vehicleParts", label: "Kodiak parts", kind: "csv", all: byPrefix(/^ITM_Vehicle(Hood|Horn|Rims|Bumper|Armor|Weapon|Mortar|Chassis|Utility|AI)_/) },
    { key: "recipes", label: "Recipes", kind: "csv", all: byPrefix(/^ITM_(Crafting_)?Recipe_/) },
    { key: "craftedRecipes", label: "Already crafted (history)", kind: "csv", all: byPrefix(/^ITM_(Crafting_)?Recipe_/), history: true, noAddAll: true,
      note: "This is the game's record of what you've crafted, not what you can craft. Unlock recipes under Recipes." },
    { key: "appearances", label: "Unlocked outfits", kind: "csv", all: () => metaData.Outfits, noAddAll: true,
      note: "The outfit list includes pieces only NPCs wear, so there's no button to add them all. Add the ones you want." },
  ];
  function getCollection(doc, def) {
    const node = child(rootOf(doc), def.key);
    if (!node) return [];
    if (def.kind === "csv") return node.textContent.split(",").filter(Boolean);
    return children(node, def.itemTag).map(n => n.textContent);
  }
  function setCollection(doc, def, codes) {
    const node = ensure(rootOf(doc), def.key);
    const uniq = [...new Set(codes)];
    if (def.kind === "csv") return setText(rootOf(doc), def.key, uniq.join(","));
    const existing = children(node, def.itemTag);
    const keep = new Set(uniq);
    let changed = false;
    for (const n of existing) if (!keep.has(n.textContent)) { n.remove(); changed = true; }
    const have = new Set(existing.filter(n => n.parentNode).map(n => n.textContent));
    for (const c of uniq) if (!have.has(c)) { node.append(newEl(doc, def.itemTag, c)); changed = true; }
    return changed;
  }
  function addToCollection(doc, def, codes) {
    const cur = getCollection(doc, def);
    const add = [].concat(codes).filter(c => !cur.includes(c));
    if (add.length) setCollection(doc, def, cur.concat(add));
    // Something you've crafted must also be a recipe you know.
    if (def.history && add.length) addToCollection(doc, collection("recipes"), add);
    return add.length;
  }
  function removeFromCollection(doc, def, code) {
    const cur = getCollection(doc, def);
    if (!cur.includes(code)) return false;
    setCollection(doc, def, cur.filter(c => c !== code));
    return true;
  }
  let codeToCollection = null;
  function collectionFor(code) {
    if (!codeToCollection) {
      codeToCollection = new Map();
      for (const def of COLLECTIONS) if (def.key !== "appearances" && !def.history) for (const c of def.all()) if (!codeToCollection.has(c)) codeToCollection.set(c, def);
    }
    return codeToCollection.get(code) || null;
  }
  const isInventoryCode = code => !isOutfitItem(code) && !collectionFor(code);

  // Outfit pieces grouped into sets by the start of their code
  // ("Elf_Male_Chest" and "Elf_Male_Legs" are both in "Elf").
  const PIECE_WORD = /^(Male|Female|Chest\d*|Legs\d*|Feet|Head|Helmet|Hands|Eyes|Face|Mask|Hair|Beard|Convo)$/;
  function outfitSetKey(code) {
    const parts = code.split("_");
    const i = parts.findIndex(p => PIECE_WORD.test(p));
    return (i > 0 ? parts.slice(0, i) : parts).join("_");
  }
  function outfitSets(doc) {
    const def = collection("appearances");
    const all = [...new Set([...def.all(), ...(doc ? getCollection(doc, def) : [])])];
    const sets = new Map();
    for (const code of all) {
      const key = outfitSetKey(code);
      if (!sets.has(key)) sets.set(key, []);
      sets.get(key).push(code);
    }
    const itemFor = {};
    for (const [item, prefix] of Object.entries(OUTFIT_PIECE_PREFIX)) itemFor[prefix.replace(/_$/, "")] = item;
    return [...sets].map(([key, pieces]) => ({
      key, pieces,
      name: itemFor[key] ? displayName(itemFor[key]) : key.replace(/_/g, " ").replace(/([a-z])([A-Z0-9])/g, "$1 $2"),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }
  function outfitSetForItem(code) {
    const prefix = OUTFIT_PIECE_PREFIX[code];
    return prefix ? prefix.replace(/_$/, "") : null;
  }

  function missingFromCollection(doc, def) {
    const have = new Set(getCollection(doc, def));
    return def.all().filter(c => !have.has(c));
  }

  // Character export / import
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CHAR_FORMAT = "wasteland3-save-editor/character";
  function exportCharacter(pc) {
    return JSON.stringify({ format: CHAR_FORMAT, version: 1, name: pcName(pc), exported: new Date().toISOString(), xml: SaveFile.serialize(pc, false) }, null, 2);
  }
  const REQUIRED_PC_PARTS = ["level", "xp", "equipment", "skills", "perks", "coordination", "luck", "awareness", "strength", "speed", "intelligence", "charisma"];

  // Reads a character export and checks it against the save without changing
  // anything. Throws if it can't be imported; otherwise returns warnings.
  function checkImport(doc, json, target) {
    let data;
    try { data = typeof json === "string" ? JSON.parse(json) : json; } catch { throw new Error("That file isn't a character export."); }
    if (!data || data.format !== CHAR_FORMAT || typeof data.xml !== "string") throw new Error("That file isn't a character export from this editor.");
    const parsed = new DOMParser().parseFromString(data.xml, "application/xml");
    if (parsed.querySelector("parsererror") || parsed.documentElement.nodeName !== "pc") throw new Error("The character file is damaged.");
    const pc = parsed.documentElement;
    const missing = REQUIRED_PC_PARTS.filter(t => !child(pc, t));
    if (missing.length) throw new Error("The character file is incomplete (missing " + missing.join(", ") + ").");
    const cid = text(pc, "companionId");
    const isCompanion = cid !== "" && cid !== "-1";
    if (isCompanion && pcs(doc).some(p => p !== target && text(p, "companionId") === cid)) {
      throw new Error(`${pcName(pc)} is already in this squad, and a companion can't be in it twice.`);
    }
    const warnings = [];
    if (isCompanion) warnings.push(`${pcName(pc)} is a story companion. Importing companions into another save may confuse the story.`);
    const targetName = text(target, "displayName");
    const followers = children(child(rootOf(doc), "followers"), "followerdata").filter(f => targetName && text(f, "pcName") === targetName);
    if (followers.length) warnings.push(`${followers.length} follower${followers.length === 1 ? " is" : "s are"} assigned to ${pcName(target)} by name and may stop following anyone.`);
    return { parsed: pc, name: pcName(pc), warnings };
  }

  // Replaces target with the imported character. Keeps the target's position
  // so they don't spawn somewhere odd, and gives items fresh uids.
  function importCharacter(doc, json, target) {
    const { parsed, warnings } = checkImport(doc, json, target);
    const pc = doc.importNode(parsed, true);
    for (const tag of ["position", "rotation"]) {
      const keep = child(target, tag), old = child(pc, tag);
      if (keep && old) old.replaceWith(keep.cloneNode(true));
      else if (keep) pc.append(keep.cloneNode(true));
    }
    for (const u of pc.querySelectorAll("uid")) if (GUID.test(u.textContent)) u.textContent = uuid();
    if (child(pc, "clientUniqueUGCKey") && text(pc, "clientUniqueUGCKey")) setText(pc, "clientUniqueUGCKey", uuid());
    target.replaceWith(pc);
    return { pc, warnings };
  }

  // Diff
  // Children are matched by a stable key where possible (uid, global name,
  // skill id, …) so inserting one item doesn't make every later item look
  // changed. Squad members are matched by companion id or name. Anything else
  // falls back to position among same-named siblings.
  const KEY_FIELDS = ["uid", "k", "skillId", "perkname", "name", "filename", "uniqueId", "instanceId", "id", "templateName", "follower"];
  const isLeaf = n => !n.firstElementChild;

  function pcIdentity(pc) {
    const cid = text(pc, "companionId");
    if (cid && cid !== "-1") return "companion " + cid;
    const name = text(pc, "displayName");
    return name ? "ranger " + name : "";
  }

  function keyPlan(parent) {
    const groups = new Map();
    for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
      if (!groups.has(c.nodeName)) groups.set(c.nodeName, []);
      groups.get(c.nodeName).push(c);
    }
    const plan = new Map(); // tag -> { by, field?, unsafe? }
    for (const [tag, list] of groups) {
      if (tag === "pc") {
        const ids = list.map(pcIdentity);
        plan.set(tag, ids.every(Boolean) && new Set(ids).size === ids.length ? { by: "pcid" } : { by: "index", unsafe: true });
        continue;
      }
      // Keyed even when alone, so it still matches when the other side has more.
      let chosen = null;
      for (const f of KEY_FIELDS) {
        const vals = list.map(c => { const k = child(c, f); return k && isLeaf(k) ? k.textContent : null; });
        if (vals.every(v => v !== null && v !== "") && new Set(vals).size === vals.length) { chosen = { by: "field", field: f }; break; }
      }
      if (!chosen && list.length > 1 && list.every(isLeaf)) {
        const vals = list.map(c => c.textContent);
        if (new Set(vals).size === vals.length) chosen = { by: "text" };
      }
      plan.set(tag, chosen || { by: "index" });
    }
    return { groups, plan };
  }
  function stepFor(node, how, index) {
    if (how.by === "field") return { tag: node.nodeName, by: "field", field: how.field, value: text(node, how.field) };
    if (how.by === "text") return { tag: node.nodeName, by: "text", value: node.textContent };
    if (how.by === "pcid") return { tag: node.nodeName, by: "pcid", value: pcIdentity(node) };
    return how.unsafe ? { tag: node.nodeName, by: "index", index, unsafe: true } : { tag: node.nodeName, by: "index", index };
  }
  function stepKey(s) { return s.tag + "|" + s.by + "|" + (s.by === "index" ? s.index : (s.field || "") + "=" + s.value); }

  function attrsDiffer(x, y) {
    if (x.attributes.length !== y.attributes.length) return true;
    for (const a of x.attributes) if (y.getAttribute(a.name) !== a.value) return true;
    return false;
  }
  // True when same-named children aren't next to each other, e.g. the
  // alternating <mod>/<perceived> pairs inside <modifier>.
  function interleaved(parent) {
    const seen = new Set();
    let prev = null;
    for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
      if (c.nodeName !== prev && seen.has(c.nodeName)) return true;
      seen.add(c.nodeName);
      prev = c.nodeName;
    }
    return false;
  }
  const tagSequence = n => children(n).map(c => c.nodeName).join(",");
  // Element as text without indentation, for comparing subtrees.
  function canon(n) {
    const attrs = [...n.attributes].map(a => ` ${a.name}="${a.value}"`).sort().join("");
    if (isLeaf(n)) return `<${n.nodeName}${attrs}>${n.textContent}</${n.nodeName}>`;
    return `<${n.nodeName}${attrs}>${children(n).map(canon).join("")}</${n.nodeName}>`;
  }

  // Differences between two saves. Each change has kind (changed / added /
  // removed), path (steps from <save>), raw before/after values, and a label;
  // beforeLabel/afterLabel hold readable names when the value is a code.
  // opts.unchanged(node) may return true for nodes of b known to be untouched
  // since b was a copy of a; their subtrees are skipped.
  function diff(a, b, opts = {}) {
    const out = [];
    const walk = (x, y, path) => {
      if (opts.unchanged && opts.unchanged(y)) return;
      if (attrsDiffer(x, y)) { out.push({ kind: "changed", path, before: summarize(x), after: summarize(y), node: y, replace: true, beforeCanon: canon(x) }); return; }
      if (isLeaf(x) && isLeaf(y)) {
        if (x.textContent === y.textContent) return;
        // Comma lists (outfits, recipes, Kodiak parts) are reported entry by entry.
        if (CSV_TAGS.has(y.nodeName) && y.parentNode === rootOf(y.ownerDocument)) {
          const before = new Set(x.textContent.split(",").filter(Boolean)), after = new Set(y.textContent.split(",").filter(Boolean));
          for (const code of after) if (!before.has(code)) out.push({ kind: "added", path, csv: code, after: code, afterLabel: displayName(code), node: y });
          for (const code of before) if (!after.has(code)) out.push({ kind: "removed", path, csv: code, before: code, beforeLabel: displayName(code), node: y });
          return;
        }
        out.push({ kind: "changed", path, before: x.textContent, after: y.textContent, node: y });
        return;
      }
      if (isLeaf(x) !== isLeaf(y)) { out.push({ kind: "changed", path, before: summarize(x), after: summarize(y), node: y, replace: true, beforeCanon: canon(x) }); return; }
      // Order matters where different tags alternate; copy the whole element.
      if ((interleaved(x) || interleaved(y)) && tagSequence(x) !== tagSequence(y)) {
        out.push({ kind: "changed", path, before: summarize(x), after: summarize(y), node: y, replace: true, beforeCanon: canon(x) });
        return;
      }
      const A = keyPlan(x), B = keyPlan(y);
      const plan = new Map();
      for (const tag of new Set([...A.plan.keys(), ...B.plan.keys()])) {
        const pa = A.plan.get(tag), pb = B.plan.get(tag);
        if (pa && pb && pa.by === pb.by && pa.field === pb.field) plan.set(tag, pa.unsafe || pb.unsafe ? { ...pa, unsafe: true } : pa);
        else if (pa && !pb) plan.set(tag, pa);
        else if (pb && !pa) plan.set(tag, pb);
        else plan.set(tag, { by: "index", unsafe: tag === "pc" });
      }
      const index = P => {
        const m = new Map();
        for (const [tag, list] of P.groups) {
          const how = plan.get(tag);
          list.forEach((n, i) => { const st = stepFor(n, how, i); m.set(stepKey(st), { node: n, step: st }); });
        }
        return m;
      };
      const ma = index(A), mb = index(B);
      for (const [k, ea] of ma) {
        const eb = mb.get(k);
        if (eb) walk(ea.node, eb.node, path.concat([ea.step]));
        else out.push({ kind: "removed", path: path.concat([ea.step]), before: summarize(ea.node), node: ea.node, beforeCanon: canon(ea.node) });
      }
      const stepOf = new Map([...mb.values()].map(e => [e.node, e.step]));
      for (const [k, eb] of mb) if (!ma.has(k)) {
        const prev = eb.node.previousElementSibling;
        out.push({ kind: "added", path: path.concat([eb.step]), after: summarize(eb.node), node: eb.node, anchor: prev ? stepOf.get(prev) : null });
      }
    };
    walk(rootOf(a.nodeType === 9 ? a : a.ownerDocument), rootOf(b.nodeType === 9 ? b : b.ownerDocument), []);
    for (const c of out) {
      c.label = describePath(c.path, c.kind === "removed" && !c.csv ? rootOf(a) : rootOf(b));
      if (c.csv) c.label += " › " + displayName(c.csv);
      if (c.kind === "changed" && !c.replace) {
        if (CODE_VALUE.test(c.before)) c.beforeLabel = displayName(c.before);
        if (CODE_VALUE.test(c.after)) c.afterLabel = displayName(c.after);
      }
    }
    return out;
  }
  const CSV_TAGS = new Set(COLLECTIONS.filter(c => c.kind === "csv").map(c => c.key));
  const CODE_VALUE = /^(ITM|PRK|QRK|BCK|ABL|EFF)_[\w-]+$/;

  function changeNode(doc, c) {
    if (c.csv || c.kind !== "removed") return resolve(doc, c.path) || (c.node && c.node.ownerDocument === doc ? c.node : null);
    return resolve(doc, c.path.slice(0, -1));
  }
  function indexAmongSame(n) {
    let i = 0;
    for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.nodeName === n.nodeName) i++;
    return i;
  }

  function findStep(n, s) {
    const list = children(n, s.tag);
    if (s.by === "index") return list[s.index] || null;
    if (s.by === "text") return list.find(c => c.textContent === s.value) || null;
    if (s.by === "pcid") {
      const hits = list.filter(c => pcIdentity(c) === s.value);
      return hits.length === 1 ? hits[0] : null;
    }
    return list.find(c => text(c, s.field) === s.value) || null;
  }
  function resolve(doc, path) {
    let n = rootOf(doc);
    for (const s of path) {
      n = findStep(n, s);
      if (!n) return null;
    }
    return n;
  }

  // Applies diff entries (from diff(before, after)) to another save.
  // Every target is found first, against the save as it is, so one change
  // can't shift what a later one points at. A change whose current value
  // isn't the "before" value is a conflict and is skipped unless opts.force.
  // Returns { applied, failed: [{change, reason}], conflicts: [{change, current}] }.
  function applyChanges(doc, changes, opts = {}) {
    const result = { applied: 0, failed: [], conflicts: [] };
    const fail = (c, reason) => result.failed.push({ change: c, reason });
    const plans = [];
    for (const c of changes) {
      if (c.path.some(s => s.unsafe)) { fail(c, "can't tell which squad member this belongs to"); continue; }
      if (c.csv) {
        const n = resolve(doc, c.path);
        if (!n) { fail(c, "not found"); continue; }
        plans.push({ c, n });
      } else if (c.kind === "changed") {
        const n = resolve(doc, c.path);
        if (!n) { fail(c, "not found"); continue; }
        if (!opts.force && (c.replace ? c.beforeCanon !== undefined && canon(n) !== c.beforeCanon : n.textContent !== c.before)) {
          result.conflicts.push({ change: c, current: c.replace ? summarize(n) + " (different contents)" : n.textContent });
          continue;
        }
        plans.push({ c, n });
      } else if (c.kind === "added") {
        const parentPath = c.path.slice(0, -1);
        const parent = resolve(doc, parentPath);
        if (!parent) { fail(c, "the place it goes doesn't exist in this save"); continue; }
        if (c.path[c.path.length - 1].by !== "index" && resolve(doc, c.path)) { fail(c, "already there"); continue; }
        const anchor = c.anchor ? findStep(parent, c.anchor) : null;
        plans.push({ c, parent, anchor, parentKey: parentPath.map(stepKey).join("/") });
      } else if (c.kind === "removed") {
        const n = resolve(doc, c.path);
        if (!n) { fail(c, "already gone"); continue; }
        if (!opts.force && c.beforeCanon !== undefined && canon(n) !== c.beforeCanon) {
          result.conflicts.push({ change: c, current: summarize(n) + " (different contents)" });
          continue;
        }
        plans.push({ c, n });
      }
    }
    const inserted = new Map(); // parentKey|stepKey -> node added in this batch
    for (const p of plans) {
      const c = p.c;
      if (c.csv) {
        const codes = p.n.textContent.split(",").filter(Boolean);
        const has = codes.includes(c.csv);
        if (c.kind === "added" && has) { fail(c, "already there"); continue; }
        if (c.kind === "removed" && !has) { fail(c, "already gone"); continue; }
        p.n.textContent = (c.kind === "added" ? codes.concat(c.csv) : codes.filter(x => x !== c.csv)).join(",");
      } else if (c.kind === "changed") {
        if (c.replace) p.n.replaceWith(doc.importNode(c.node, true));
        else p.n.textContent = c.after;
      } else if (c.kind === "added") {
        const node = doc.importNode(c.node, true);
        const after = p.anchor || (c.anchor && inserted.get(p.parentKey + "|" + stepKey(c.anchor)));
        if (after && after.parentNode === p.parent) after.after(node);
        else if (c.anchor === null) p.parent.insertBefore(node, p.parent.firstElementChild);
        else p.parent.append(node);
        inserted.set(p.parentKey + "|" + stepKey(c.path[c.path.length - 1]), node);
      } else if (c.kind === "removed") {
        p.n.remove();
      }
      result.applied++;
    }
    return result;
  }

  // Human readable labels
  const SECTION_NAMES = {
    pcs: "Squad", hostInventory: "Inventory", globals: "Story flags", cars: "Vehicles", levels: "Map areas",
    quests: "Quests", conversations: "Conversations", factions: "Factions", worldMap: "World map",
    followers: "Followers", animalCompanions: "Animal companions", nonPartyCnpcs: "Companions not in party",
    cassettetapes: "Cassette tapes", creepydolls: "Creepy dolls", appearances: "Unlocked outfits",
    vehicleParts: "Kodiak parts", recipes: "Recipes", craftedRecipes: "Crafting recipes", paintJobs: "Paint jobs",
    money: "Money", statusEffects: "Status effects", perks: "Perks", abilities: "Abilities", skills: "Skills",
    equipment: "Equipment", hitpoints: "Hit points", availableAttributePoints: "Unspent attribute points",
    availableSkillPoints: "Unspent skill points", perkPoints: "Unspent perk points", xp: "XP", level: "Level",
  };
  function friendlyTag(tag) { return SECTION_NAMES[tag] || tag; }
  function nodeLabel(n) {
    switch (n.nodeName) {
      case "pc": return pcName(n);
      case "item": return displayName(text(n, "templateName")) || "item";
      case "skill": return SKILLS[text(n, "skillId")] || "skill " + text(n, "skillId");
      case "perk": return displayName(text(n, "perkname"));
      case "statusEffect": return displayName(text(n, "name"));
      case "global": return text(n, "k");
      case "level": return text(n, "name") ? locationName(text(n, "name")) : "level";
      case "car": return carName(n, indexAmongSame(n));
      default:
        if (isLeaf(n) && /^[A-Z]{3}_/.test(n.textContent)) return displayName(n.textContent);
        return friendlyTag(n.nodeName);
    }
  }
  function describePath(path, root) {
    const parts = [];
    let n = root;
    for (const s of path) {
      const next = findStep(n, s);
      if (!next) { parts.push(friendlyTag(s.tag)); break; }
      n = next;
      // Skip noise like "global › v" -> just the global's name.
      if (n.nodeName === "v" && n.parentNode.nodeName === "global") continue;
      if (n.nodeName === "level" && n.parentNode.nodeName === "skill") { parts.push("level"); continue; }
      parts.push(nodeLabel(n));
    }
    return parts.join(" › ");
  }
  function summarize(n) {
    if (isLeaf(n)) return n.textContent.length > 80 ? n.textContent.slice(0, 77) + "…" : n.textContent;
    if (n.nodeName === "item") return `${text(n, "quantity") || 1} × ${displayName(text(n, "templateName"))}`;
    return nodeLabel(n);
  }
  function sectionOf(change) { return change.path.length ? friendlyTag(change.path[0].tag) : "Save"; }

  return {
    INT_MAX, INT_MIN, GUID, clampInt, isDevCode,
    getGlobal, setGlobal, deleteGlobal, listGlobals, PARTY_STATS, reputations,
    makeItem, addInventoryItem, isStackable, MAX_COPIES, splitStack, duplicateItem, getScrap, setScrap, itemCategory, ITEM_CATEGORIES, isInventoryCode,
    ATTRIBUTES, SKILLS, COMBAT_SHOOTING, pcs, pcName, pcIdentity, setAllAttributes, findSkill, setSkill,
    PERK_ABILITIES, hasPerk, addPerk, removePerk, setSinglePerk, abilities, hasAbility, addAbility, removeAbility,
    MUTATIONS, statusEffects, hasStatusEffect, addStatusEffect, removeStatusEffect,
    GEAR_SLOTS, slotLabel, equipped, equip, equipNew, unequip, outfitOptions,
    vehicleSlot, setVehiclePart, cars, carName,
    COLLECTIONS, collection, getCollection, addToCollection, removeFromCollection, missingFromCollection, collectionFor,
    isOutfitItem, unlockOutfit, outfitSets, outfitSetKey, outfitSetForItem,
    exportCharacter, checkImport, importCharacter,
    diff, resolve, applyChanges, changeNode, sectionOf,
  };
})();
