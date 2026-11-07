"use strict";

describe("Names", () => {
  it("builds names from codes", () => {
    expect(prettyCode("PRK_SniperRifles_MasterfulPrecision")).toBe("Masterful Precision");
    expect(prettyCode("ITM_DLC1_Equip_Weapon_SniperRifle_DisruptionRay_Elite_Tier3")).toBe("Disruption Ray Elite (T3)");
    expect(prettyCode("Ammo556mm")).toBe("Ammo 556 mm");
    expect(prettyCode("BCK_LuciaWesson")).toBe("Lucia Wesson");
    expect(prettyCode("")).toBe("");
  });

  it("prefers the game's own names and keeps the tier", () => {
    expect(displayName("ITM_Consumable_Healing_MedicPack")).toBe("Medic Pack");
    expect(displayName("ITM_Equip_Weapon_SniperRifle_Tier6-1_SR2000Argent")).toBe("SR2000-Argent (T6)");
    expect(displayName("Made_Up_Code")).toBe(prettyCode("Made_Up_Code"));
  });
});

describe("Location names", () => {
  it("builds a readable name from the scene code", () => {
    expect(locationName("ar_m2001_AmbushSite")).toBe("Ambush Site");
    expect(locationName("ar_a1011_RangerHQ_Endgame")).toBe("Ranger HQ (Endgame)");
    expect(locationName("ar_0000_WorldMap")).toBe("World Map");
    expect(locationName("")).toBe("");
  });
});

describe("Element helpers", () => {
  it("sets text and reports whether it changed", () => {
    const d = Fixtures.doc("<save><a>1</a></save>");
    expect(setText(d.documentElement, "a", 1)).toBeFalsy();
    expect(setText(d.documentElement, "a", 2)).toBeTruthy();
    expect(setText(d.documentElement, "b", 3)).toBeTruthy();
    expect(SaveFile.serialize(d, false)).toBe("<save><a>2</a><b>3</b></save>");
  });

  it("adds classes rather than replacing them", () => {
    const b = el("button.toggle", { class: "on good" });
    expect(b.className).toBe("toggle on good");
  });

  it("makes version 4 uuids", () => {
    const seen = new Set();
    for (let i = 0; i < 100; i++) seen.add(uuid());
    expect(seen.size).toBe(100);
    for (const u of seen) expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("Picker search", () => {
  const list = ["ITM_Consumable_Healing_MedicPack", "ITM_Consumable_MedicPack_Fortifying", "ITM_Recipe_Consumable_Healing_MedicPack", "ITM_Scrap"];

  it("matches every word in any order", () => {
    const hits = searchEntries(list, "pack medic").map(e => e.value);
    expect(hits.includes("ITM_Scrap")).toBeFalsy();
    expect(hits.length).toBe(3);
  });

  it("ranks exact name matches first", () => {
    expect(searchEntries(list, "medic pack")[0].name).toBe("Medic Pack");
  });

  it("matches codes as well as names", () => {
    expect(searchEntries(list, "itm_scrap").map(e => e.value)).toEqual(["ITM_Scrap"]);
  });

  it("returns the start of the list for an empty search", () => {
    expect(searchEntries(list, "").length).toBe(4);
  });
});

describe("Wiki links", () => {
  it("goes straight to a page with the item's name", () => {
    const url = wikiUrl("Medic Pack");
    expect(url).toContain("Special:Search?go=Go&search=Medic%20Pack");
  });

  it("drops the tier from the page name", () => {
    expect(wikiUrl("SR2000-Argent (T6)")).toContain("search=SR2000-Argent");
    expect(wikiUrl("SR2000-Argent (T6)").includes("T6")).toBeFalsy();
  });
});

describe("Pager", () => {
  it("is hidden for a single page", () => {
    expect(pager(10, 0, 50, () => {})).toBe(null);
  });

  it("shows the range and moves between pages", () => {
    let went = null;
    const p = pager(120, 1, 50, n => (went = n));
    expect(p.textContent).toContain("Page 2 of 3");
    expect(p.textContent).toContain("51–100 of 120");
    [...p.querySelectorAll("button")].find(b => b.textContent.includes("Next")).click();
    expect(went).toBe(2);
  });
});
