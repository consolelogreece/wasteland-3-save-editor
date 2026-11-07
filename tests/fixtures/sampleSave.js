// Small made-up save with the same structure as a real one.
"use strict";

const Fixtures = (() => {
  const item = (tpl, slot, qty, uid, mods = "") =>
    `<item><templateName>${tpl}</templateName><slot>${slot}</slot><ammoLoaded>0</ammoLoaded><quantity>${qty}</quantity><uid>${uid}</uid><isLockedForMerchant>False</isLockedForMerchant><merchantBarterLevelRequirement>0</merchantBarterLevelRequirement>${mods}</item>`;
  const g = (k, v) => `<global><k>${k}</k><v>${v}</v></global>`;

  const XML = "<save>" +
    "<version>0.91</version><currentScene>ar_a1001_RangerHQ</currentScene><saveTime>20241208T17:40:01+0</saveTime>" +
    "<difficulty>3</difficulty><cameraZoom>0</cameraZoom><money>5657</money>" +
    "<levels><level><name>ar_m2001_AmbushSite</name><interactables><interactable><id>a1</id><modifiers>" +
    "<modifier><mod>8</mod><perceived>True</perceived><mod>8</mod><perceived>True</perceived>\n\t\t\t<mod>3</mod><perceived>False</perceived></modifier>" +
    "</modifiers></interactable></interactables></level></levels>" +
    "<pcs>" +
      "<pc><displayName>Zoë &amp; Co</displayName><isCustomDisplayName>True</isCustomDisplayName><clientUniqueUGCKey>e5cd2d96-1198-46e0-944c-f5b66d34d10a</clientUniqueUGCKey>" +
      "<level>26</level><xp>57758</xp><hitpoints>193</hitpoints><companionId>-1</companionId>" +
      "<coordination>10</coordination><luck>8</luck><awareness>10</awareness><strength>3</strength><speed>5</speed><intelligence>7</intelligence><charisma>2</charisma>" +
      "<availableAttributePoints>0</availableAttributePoints><availableSkillPoints>0</availableSkillPoints>" +
      "<equipment>" +
        item("ITM_Equip_Weapon_SniperRifle_Tier6-1_SR2000Argent", 1, 1, "f9d08bee-718e-485b-b0c9-7246922aa476", "<mods><mod>ITM_WeaponMod_Ranged_Barrel_Tier2-3</mod></mods>") +
        item("ITM_Equip_Armor_Chest_Light_Tier6-1_RangerArmor", 3, 1, "aaaaaaaa-0000-4000-8000-000000000003") +
        item("RangerD_Male_Chest", 5, 1, "aaaaaaaa-0000-4000-8000-000000000005") +
        item("ITM_Consumable_Healing_MedicPack", 23, 1, "aaaaaaaa-0000-4000-8000-000000000023") +
      "</equipment>" +
      "<skills><skill><skillId>80</skillId><level>7</level></skill><skill><skillId>210</skillId><level>10</level></skill></skills>" +
      "<abilities><ability>ABL_ReviveDownedPc</ability><ability>ABL_MarkTarget</ability></abilities>" +
      "<position><x>-14.5</x><y>30.1</y><z>32.0</z></position><rotation>80</rotation>" +
      "<perks><perk><perkname>BCK_ViciousAvenger</perkname></perk><perk><perkname>QRK_None</perkname></perk><perk><perkname>PRK_Generic_Healthy</perkname></perk><perk><perkname>PRK_SniperRifles_MarkTarget</perkname></perk></perks>" +
      "<perkPoints>0</perkPoints>" +
      "<statusEffects><statusEffect><name>EFF_Radiation_FleshPocket</name><turnsRemaining>1</turnsRemaining></statusEffect></statusEffects>" +
      "</pc>" +
      "<pc><level>25</level><xp>48021</xp><hitpoints>150</hitpoints><companionId>7</companionId>" +
      "<coordination>5</coordination><luck>3</luck><awareness>6</awareness><strength>4</strength><speed>3</speed><intelligence>4</intelligence><charisma>4</charisma>" +
      "<availableAttributePoints>0</availableAttributePoints><availableSkillPoints>2</availableSkillPoints>" +
      "<equipment></equipment><skills><skill><skillId>60</skillId><level>10</level></skill></skills><abilities></abilities>" +
      "<position><x>1</x><y>2</y><z>3</z></position><rotation>10</rotation>" +
      "<perks><perk><perkname>BCK_LuciaWesson</perkname></perk></perks><perkPoints>1</perkPoints><statusEffects></statusEffects>" +
      "</pc>" +
    "</pcs><rosterpcs></rosterpcs>" +
    "<cars><car><carType>0</carType><hp>2400</hp><equipment>" +
      item("ITM_Vehicle_Turret_PatriotBlaster", 1, 1, "1e5752bc-f20a-44fe-80bb-9215a808490e") +
      item("ITM_VehicleArmor_HeavyArmorPlating", 18, 1, "7ef64a06-464e-4691-95b9-85418383093e") +
    "</equipment><tintColor>0</tintColor></car></cars>" +
    "<hostInventory>" +
      item("ITM_Consumable_Healing_MedicPack", 0, 13, "87e0f53b-6067-4fc6-a29b-a51f8c664990") +
      item("ITM_Scrap", 0, 9272, "bbbbbbbb-0000-4000-8000-000000000001") +
      item("ITM_Equip_Weapon_SniperRifle_Tier3-1_PerkeleModel85", 0, 2, "bbbbbbbb-0000-4000-8000-000000000002") +
      item("ITM_Equip_Armor_Helmet_Light_Tier6-1_RangerHelmet", 0, 1, "bbbbbbbb-0000-4000-8000-000000000003") +
    "</hostInventory><partyStash></partyStash>" +
    "<appearances>Scientist_Male_Chest,RangerN_Male_Chest</appearances>" +
    "<creepydolls><creepydoll>ITM_CreepyDoll_Zoophiliac</creepydoll></creepydolls>" +
    "<cassettetapes><cassettetape>ITM_CassetteTape_B_Denver_ANewWell</cassettetape></cassettetapes>" +
    "<vehicleParts>ITM_VehicleHood_WolfSkull,ITM_VehicleHorn_Police</vehicleParts>" +
    "<recipes>ITM_Recipe_Consumable_Healing_MedicPack</recipes><craftedRecipes></craftedRecipes>" +
    "<paintJobs><paintJob>0</paintJob></paintJobs>" +
    "<globals>" + g("G_Fame", 107) + g("G_RangerAllegiance", 85) + g("G_Reputation_Gippers", -1996) +
      g("G_Reputation_Changed_Gippers", 1) + g("a5101_Patriarch_HadFirstConversation", 1) + "</globals>" +
    "<factions><hateOverride><factionA>161</factionA><factionB>0</factionB><hate>True</hate></hateOverride></factions>" +
    "<quests><quest><filename>-956414363</filename><failed>False</failed></quest></quests>" +
    "</save>";

  const HEADER = {
    Version: "0.91", Location: "ar_a1001_RangerHQ", SaveTime: "20241208T17:40:01+0",
    Hash: "", Indices: "72|9", Names: "Zoë", Levels: "26|25", Permadeath: "False",
  };

  // Builds a complete save file (header + LZF-compressed XML) as bytes.
  function saveBytes(xml = XML, header = HEADER) {
    const body = new TextEncoder().encode(xml);
    const compressed = compress(body);
    const lines = ["XLZF"];
    for (const [k, v] of Object.entries(header)) {
      lines.push(k + ":=" + v);
      if (k === "SaveTime") lines.push("DataSize:=" + body.length, "SaveDataSize:=" + compressed.length);
    }
    // Header bytes as written by the game: UTF-8 text.
    const head = new TextEncoder().encode(lines.join("\n") + "\n");
    const out = new Uint8Array(head.length + compressed.length);
    out.set(head, 0);
    out.set(compressed, head.length);
    return out;
  }

  function load(xml) { return SaveFile.read(saveBytes(xml).buffer); }
  function doc(xml = XML) { return new DOMParser().parseFromString(xml, "application/xml"); }

  return { XML, HEADER, saveBytes, load, doc };
})();
