"use strict";

describe("Code lists", () => {
  const lists = Object.entries(metaData).filter(([, v]) => Array.isArray(v));

  it("have no duplicates", () => {
    for (const [name, codes] of lists) expect(name + ":" + (codes.length - new Set(codes).size)).toBe(name + ":0");
  });

  it("only contain characters a save can hold", () => {
    for (const [, codes] of lists) for (const c of codes) expect(c).toMatch(/^[A-Za-z0-9_\-]+$/);
  });

  it("have unique skill ids", () => {
    const ids = Object.values(metaData.Skills);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Model.SKILLS[Model.COMBAT_SHOOTING]).toBe("Combat Shooting");
  });

  it("include every ability a perk grants", () => {
    for (const [perk, ability] of Object.entries(Model.PERK_ABILITIES)) {
      expect(metaData["Quirks Perks and Backgrounds"].includes(perk) ? perk : "missing " + perk).toBe(perk);
      expect(metaData.Abilities.includes(ability) ? ability : "missing " + ability).toBe(ability);
    }
  });

  it("include every mutation", () => {
    for (const m of Model.MUTATIONS) expect(metaData["Status Effects"].includes(m.code) ? m.code : "missing " + m.code).toBe(m.code);
  });

  it("have game names that are plain text", () => {
    for (const [code, name] of Object.entries(GameNames)) {
      expect(typeof name).toBe("string");
      expect(name.trim().length > 0 ? code : "empty " + code).toBe(code);
    }
  });

  it("give every collectible collection something to add", () => {
    for (const c of Model.COLLECTIONS) expect(c.all().length).toBeGreaterThan(0);
  });
});
