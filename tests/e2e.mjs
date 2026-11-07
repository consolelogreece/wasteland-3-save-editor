// End-to-end tests: drive the real page the way a person would.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function downloadedBytes(file) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "w3se-")), file.suggestedFilename());
  await file.saveAs(out);
  return fs.readFileSync(out);
}

function check(cond, msg) { if (!cond) throw new Error(msg); }
function equal(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function fixtureBytes(page, xml) {
  if (!(await page.evaluate(() => typeof Fixtures !== "undefined"))) await page.addScriptTag({ url: "/tests/fixtures/sampleSave.js" });
  return Buffer.from(await page.evaluate(x => Array.from(Fixtures.saveBytes(x || undefined)), xml || null));
}

async function open(page, bytes, name = "Quicksave1.xml") {
  // Each open gets a fresh document; wait for that rather than for markup a
  // previous open may have left behind.
  await page.evaluate(() => { window.lastDoc = window.App && App.save ? App.save.doc : null; });
  await page.setInputFiles("#fileInput", { name, mimeType: "application/octet-stream", buffer: bytes });
  await page.waitForFunction(() => App.save && App.save.doc !== window.lastDoc && document.querySelector("#view-simple .overview"));
}

async function openFixture(page, xml) { await open(page, await fixtureBytes(page, xml)); }

// Click Download, confirm in the review dialog and return the parsed XML.
async function download(page) {
  await page.click("#downloadBtn");
  await page.waitForSelector(".modal");
  const review = await page.textContent(".modal-body");
  const [file] = await Promise.all([page.waitForEvent("download"), page.click(".modal-actions .btn.primary")]);
  const bytes = await downloadedBytes(file);
  const xml = await page.evaluate(b => SaveFile.serialize(SaveFile.read(new Uint8Array(b).buffer).doc, false), Array.from(bytes));
  return { bytes, xml, review, name: file.suggestedFilename() };
}

const value = (xml, tag) => (new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml) || [])[1];
const changeCount = page => page.evaluate(() => { Changes.compute(); return Changes.count(); });

export function endToEnd({ savePath }) {
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);

  test("shows where saves are kept for each platform", async page => {
    const box = page.locator("#dropzone [data-save-paths]");
    await box.locator("button:text-is('Windows')").click();
    check((await box.locator("code").textContent()) === "%USERPROFILE%\\Documents\\My Games\\Wasteland3\\Save Games\\", "windows path");
    await box.locator("button:has-text('Mac')").click();
    check((await box.locator("code").textContent()).startsWith("~/Library/Application Support/Wasteland3"), "mac path");
    await box.locator("button:has-text('Linux')").click();
    check((await box.locator("code").textContent()).startsWith("~/.config/Wasteland3"), "linux path");
    check(await box.locator("button:has-text('Copy')").isVisible(), "copy button");
  });

  test("says the editor is used at your own risk", async page => {
    check(/own risk/.test(await page.textContent("#dropzone .caution")), "warning on the open screen");
    check(/own risk/.test(await page.textContent(".site-footer")), "warning in the footer");
  });

  test("warns when a skill is raised and offers skill points instead", async page => {
    await openFixture(page);
    await page.click(".subtabs button:has-text('Squad')");
    const skills = page.locator("section[data-section='Skills']");
    check(!(await skills.locator(".caution").count()), "no warning before any change");
    check(!(await page.locator("text=Combat Shooting is a hidden skill").count()), "no separate Combat Shooting box");
    const box = skills.locator(".row input").first();
    const before = await box.inputValue();
    await box.fill(String(+before + 2));
    check(/raised from/.test(await skills.locator(".caution").textContent()), "warning appears while typing");
    equal(await page.evaluate(() => document.activeElement.tagName), "INPUT", "focus stays in the box");
    await skills.locator(".caution button").click();
    equal(await skills.locator(".row input").first().inputValue(), before, "old level put back");
    check(!(await skills.locator(".caution").count()), "warning gone");
    equal(await page.evaluate(() => document.activeElement.closest("[data-focus]").dataset.focus), "skillpoints", "cursor in unspent skill points");
  });

  test("warns when a perk is added and can swap it for a perk point", async page => {
    await openFixture(page);
    await page.click(".subtabs button:has-text('Squad')");
    const perks = page.locator("section[data-section='Background, quirk & perks']");
    const points = +(await page.inputValue("[data-focus=perkpoints] input"));
    await perks.locator("input[placeholder^='Find a perk']").fill("rally");
    await perks.locator("[role=option]").first().click();
    await perks.locator("button:has-text('Add perk')").click();
    check(/skips the game's requirements/.test(await perks.locator(".caution").textContent()), "warning after adding");
    await perks.locator(".caution button").click();
    equal(+(await page.inputValue("[data-focus=perkpoints] input")), points + 1, "one perk point given");
    check(!(await page.locator("section[data-section='Background, quirk & perks'] .caution").count()), "warning gone");
  });

  test("perk warning comes back after undo, and survives a raw XML edit", async page => {
    await openFixture(page);
    await page.click(".subtabs button:has-text('Squad')");
    const perks = () => page.locator("section[data-section='Background, quirk & perks']");
    await perks().locator("input[placeholder^='Find a perk']").fill("rally");
    await perks().locator("[role=option]").first().click();
    await perks().locator("button:has-text('Add perk')").click();
    await perks().locator(".caution button").click();
    check(!(await perks().locator(".caution").count()), "gone after swapping for a point");
    await page.click("#undoBtn");
    check(/skips the game's requirements/.test(await perks().locator(".caution").textContent()), "back after undo");
    await page.selectOption("#viewSelect", "raw");
    await page.waitForFunction(() => (document.querySelector(".raw-fallback") || {}).value?.includes("PRK_"));
    await page.$eval(".raw-fallback", t => { t.value = t.value.replace("<difficulty>3</difficulty>", "<difficulty>2</difficulty>"); t.dispatchEvent(new Event("input")); });
    await page.selectOption("#viewSelect", "simple");
    check(/skips the game's requirements/.test(await perks().locator(".caution").textContent()), "still there after the raw edit");
  });

  test("no false 'not downloaded' warning after undoing everything", async page => {
    await openFixture(page);
    await page.fill("[data-focus=money] input", "1");
    await page.locator("[data-focus=money] input").blur();
    await page.click("#undoBtn");
    let asked = false;
    page.on("dialog", d => { asked = true; d.dismiss(); });
    await open(page, await fixtureBytes(page));
    check(!asked, "didn't ask about unsaved changes");
  });

  test("two boxes for the same story flag stay in step", async page => {
    await openFixture(page);
    await page.click(".subtabs button:has-text('World')");
    await page.fill(".card:has(h3:text('Story flags')) input[type=search]", "G_Fame");
    await page.fill("[data-focus='flag:G_Fame'] input", "300");
    await page.focus("[data-focus=G_Fame] input");
    await page.locator("[data-focus=G_Fame] input").blur();
    equal(await page.inputValue("[data-focus=G_Fame] input"), "300", "overview box shows the new value after leaving it");
    equal(await page.evaluate(() => Model.getGlobal(App.save.doc, "G_Fame")), "300", "save has it");
  });

  test("says how to put the save back, and keeps saying it", async page => {
    await openFixture(page);
    await page.fill("[data-focus=money] input", "1");
    await download(page);
    await page.waitForTimeout(3500);
    check(/over the original/.test(await page.textContent("#nextStep")), "next step still shown");
  });

  test("Compare keeps the open save as it was when picked", async page => {
    await openFixture(page);
    await page.click("#tabs [data-tab=compare]");
    await page.click(".compare-slots button:has-text('Use the open save') >> nth=0");
    await page.click("#tabs [data-tab=edit]");
    await page.fill("[data-focus=money] input", "200");
    await page.click("#tabs [data-tab=compare]");
    await page.click(".compare-slots button:has-text('Use the open save') >> nth=1");
    await page.click("#tab-compare .row-actions .btn.primary:has-text('Compare')");
    await page.waitForFunction(() => /Money/.test(document.querySelector("#tab-compare").textContent));
  });

  test("warns when Level is raised", async page => {
    await openFixture(page);
    await page.click(".subtabs button:has-text('Squad')");
    const basics = page.locator("section[data-section='Basics']");
    const level = basics.locator("label.field:has-text('Level') input").first();
    await level.fill(String(+(await level.inputValue()) + 1));
    check(/Level raised from/.test(await basics.locator(".caution").textContent()), "level warning");
  });

  test("links in warnings jump to the right place", async page => {
    await openFixture(page);
    await page.click(".subtabs button:has-text('Squad')");
    await page.click("section[data-section='Skills'] .hint .link-btn");
    await page.waitForSelector("section[data-section='Basics'].section-flash");
    equal(await page.evaluate(() => document.activeElement.closest("[data-focus]").dataset.focus), "skillpoints", "cursor in unspent skill points");
    await page.selectOption("#viewSelect", "tree");
    await page.click("#view-tree .caution .link-btn");
    await page.waitForSelector("#view-simple:not([hidden]) .overview");
    equal(await page.inputValue("#viewSelect"), "simple", "view picker follows");
  });

  test("shows a readable location name", async page => {
    await openFixture(page);
    equal(await page.textContent(".overview .stat strong"), "Ranger HQ", "location");
  });

  test("rejects a file that isn't a save", async page => {
    await page.setInputFiles("#fileInput", { name: "notes.xml", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await page.waitForSelector("#banner:not([hidden])");
    check((await page.textContent("#banner")).includes("doesn't look like a Wasteland 3 save"), "error message");
  });

  test("downloads an unchanged save with identical XML", async page => {
    await openFixture(page);
    const original = await page.evaluate(() => Fixtures.XML);
    const out = await download(page);
    equal(out.xml, original, "xml");
    equal(out.name, "Quicksave1.xml", "file name");
    check(out.review.includes("Nothing has changed"), "review says nothing changed");
  });

  test("edits money, counts the change and lists it before download", async page => {
    await openFixture(page);
    await page.fill("[data-focus=money] input", "123456");
    await page.waitForFunction(() => document.getElementById("changeBadge").textContent === "1 change");
    const out = await download(page);
    equal(value(out.xml, "money"), "123456", "money");
    check(out.review.includes("5657") && out.review.includes("123456"), "review shows old and new values");
    check(!/\bnull\b/.test(out.review), "no stray null in the review");
  });

  test("undo and redo with buttons and keyboard", async page => {
    await openFixture(page);
    await page.fill("[data-focus=money] input", "1");
    await page.click("#undoBtn");
    equal(await page.inputValue("[data-focus=money] input"), "5657", "after undo");
    await page.click("#redoBtn");
    equal(await page.inputValue("[data-focus=money] input"), "1", "after redo");
    await page.click("h1");
    await page.keyboard.press("Control+z");
    equal(await page.inputValue("[data-focus=money] input"), "5657", "after Ctrl+Z");
    equal(await changeCount(page), 0, "changes after undo");
  });

  test("adds an item by searching for it", async page => {
    await openFixture(page);
    await page.click(".subtabs button:has-text('Inventory')");
    await page.fill(".add-row input.qty", "7");
    await page.fill("#inventory-picker input", "med hypo");
    await page.keyboard.press("Enter");
    equal(await changeCount(page), 0, "picking alone doesn't change the save");
    await page.click("#inventory-picker button:has-text('Add to inventory')");
    const out = await download(page);
    check(/<templateName>ITM_Consumable_Healing_MedHypo<\/templateName><slot>0<\/slot><ammoLoaded>0<\/ammoLoaded><quantity>7<\/quantity><uid>[0-9a-f-]{36}<\/uid>/.test(out.xml), "new item in xml");
  });

  test("toggles a mutation and adds a perk with its ability", async page => {
    await openFixture(page);
    await page.click(".toggle:has-text('Third Eye')");
    await page.fill(".card:has(h3:text('Background, quirk & perks')) .picker input", "rally");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    const out = await download(page);
    check(out.xml.includes("<statusEffect><name>EFF_Radiation_ThirdEye</name><turnsRemaining>1</turnsRemaining></statusEffect>"), "mutation");
    check(out.xml.includes("<perkname>PRK_Leadership_Rally</perkname>"), "perk");
    check(out.xml.includes("<ability>ABL_Leadership_Rally</ability>"), "ability");
  });

  test("equips a helmet from the inventory", async page => {
    await openFixture(page);
    await page.click(".row:has(.slot-label:text('Helmet')) button:has-text('Equip')");
    await page.fill(".modal .picker input", "helmet");
    await page.keyboard.press("Enter");
    const out = await download(page);
    check(/<item><templateName>ITM_Equip_Armor_Helmet_Light_Tier6-1_RangerHelmet<\/templateName><slot>28<\/slot>/.test(out.xml), "helmet equipped in slot 28");
  });

  test("equips something that isn't in the inventory yet", async page => {
    await openFixture(page);
    await page.click(".row:has(.slot-label:text('Primary weapon')) button:has-text('Change')");
    await page.fill(".modal .picker input", "ITM_Equip_Weapon_SniperRifle_Tier1-1_SlagSniper");
    await page.keyboard.press("Enter");
    const out = await download(page);
    check(/<item><templateName>ITM_Equip_Weapon_SniperRifle_Tier1-1_SlagSniper<\/templateName><slot>1<\/slot>/.test(out.xml), "new weapon equipped");
    check(/<item><templateName>ITM_Equip_Weapon_SniperRifle_Tier6-1_SR2000Argent<\/templateName><slot>0<\/slot>/.test(out.xml), "old weapon moved to inventory");
  });

  test("lists changes since the last download", async page => {
    await openFixture(page);
    await page.fill("[data-focus=money] input", "1");
    await download(page);
    await page.fill("[data-focus=G_Fame] input", "5");
    await page.waitForFunction(() => document.getElementById("changeBadge").textContent === "1 change since download");
    await page.click("#changeBadge");
    const since = await page.textContent(".modal-body");
    check(since.includes("1 change since your last download") && since.includes("G_Fame") && !since.includes("Money"), "since download list");
    await page.click(".modal-body button:has-text('Since opening')");
    const all = await page.textContent(".modal-body");
    check(all.includes("2 changes since you opened") && all.includes("Money"), "since open list");
  });

  test("adds every missing creepy doll", async page => {
    await openFixture(page);
    await page.click(".subtabs button:has-text('Collectibles')");
    await page.click("details:has-text('Creepy dolls') summary");
    await page.click("details:has-text('Creepy dolls') button:has-text('Tick all')");
    const out = await download(page);
    const dolls = await page.evaluate(() => metaData.Items.filter(c => c.startsWith("ITM_CreepyDoll_")).length);
    equal((out.xml.match(/<creepydoll>/g) || []).length, dolls, "doll count");
  });

  test("changes fame, reputation and a story flag", async page => {
    await openFixture(page);
    await page.fill("[data-focus=G_Fame] input", "300");
    await page.click(".subtabs button:has-text('World')");
    await page.fill("[data-focus=G_Reputation_Gippers] input", "50");
    await page.fill(".card:has(h3:text('Story flags')) input[type=search]", "Patriarch");
    await page.fill("[data-focus='flag:a5101_Patriarch_HadFirstConversation'] input", "0");
    const out = await download(page);
    check(out.xml.includes("<k>G_Fame</k><v>300</v>"), "fame");
    check(out.xml.includes("<k>G_Reputation_Gippers</k><v>50</v>"), "reputation");
    check(out.xml.includes("<k>a5101_Patriarch_HadFirstConversation</k><v>0</v>"), "flag");
  });

  test("swaps a Kodiak part", async page => {
    await openFixture(page);
    await page.click(".subtabs button:has-text('Kodiak')");
    await page.click(".row:has(.slot-label:text('Armor')) button:has-text('Change')");
    await page.fill(".modal .picker input", "VehicleArmor_AlloyArmorPlating");
    await page.keyboard.press("Enter");
    const out = await download(page);
    check(out.xml.includes("<templateName>ITM_VehicleArmor_AlloyArmorPlating</templateName><slot>18</slot>"), "armor swapped");
  });

  test("highlights changes in the tree view", async page => {
    await openFixture(page);
    await page.fill("[data-focus=money] input", "1");
    await page.selectOption("#viewSelect", "tree");
    await page.waitForSelector("li.changed");
    check((await page.textContent("li.changed")).includes("money"), "money row highlighted");
  });

  test("raw XML edits apply, and invalid XML is held back", async page => {
    await openFixture(page);
    await page.selectOption("#viewSelect", "raw");
    await page.waitForFunction(() => (document.querySelector(".raw-fallback") || {}).value?.includes("<money>5657</money>"));
    await page.$eval(".raw-fallback", t => { t.value = t.value.replace("<money>5657</money>", "<money>77</money>"); t.dispatchEvent(new Event("input")); });
    await page.selectOption("#viewSelect", "simple");
    equal(await page.inputValue("[data-focus=money] input"), "77", "money after raw edit");
    await page.selectOption("#viewSelect", "raw");
    await page.$eval(".raw-fallback", t => { t.value = t.value.replace("<money>77</money>", "<money>77</mony>"); t.dispatchEvent(new Event("input")); });
    await page.selectOption("#viewSelect", "simple");
    check(await page.isVisible("#banner"), "banner about invalid XML");
    equal(await page.inputValue("#viewSelect"), "raw", "stays on raw view");
  });

  test("outfits are unlocked rather than added to the inventory", async page => {
    await openFixture(page);
    await page.click(".subtabs button:has-text('Inventory')");
    await page.fill("#inventory-picker input", "hipster outfit");
    const options = await page.locator(".picker-list li").allTextContents();
    check(!options.some(o => o.includes("ITM_Appearance_HipsterOutfit")), "hipster outfit not offered for the inventory");
    await page.click("#tabs [data-tab=codes]");
    await page.fill("#tab-codes input[type=search]", "elf outfit");
    await page.click("#tab-codes .code-row:has(code:text-is('ITM_Appearance_ElfOutfit')) button:has-text('Show in Collectibles')");
    await page.waitForSelector(".outfit-set[data-set=Elf]");
    await page.check(".outfit-set[data-set=Elf] > .row input[type=checkbox]");
    const out = await download(page);
    check(/<appearances>[^<]*Elf_Male_Chest/.test(out.xml), "elf pieces unlocked");
    check(!out.xml.includes("<templateName>ITM_Appearance_ElfOutfit</templateName>"), "no outfit item added");
    check(out.review.includes("Elf Male Chest"), "review lists pieces by name");
    check(!out.review.includes("Scientist_Male_Chest,RangerN"), "review doesn't dump the whole list");
  });

  test("Codes tab adds items without leaving the tab", async page => {
    await openFixture(page);
    await page.click("#tabs [data-tab=codes]");
    await page.fill("#tab-codes input[type=search]", "med hypo");
    await page.click("#tab-codes .code-row:has(code:text-is('ITM_Consumable_Healing_MedHypo')) button:has-text('Add to inventory')");
    equal(await changeCount(page), 1, "changes");
  });

  test("Ctrl+K search jumps to a field", async page => {
    await openFixture(page);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("scrap");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement && document.activeElement.closest("[data-focus=scrap]"));
  });

  test("compares two saves and copies the difference", async page => {
    await openFixture(page);
    const after = await fixtureBytes(page, await page.evaluate(() => Fixtures.XML.replace("<k>G_Fame</k><v>107</v>", "<k>G_Fame</k><v>999</v>")));
    const before = await fixtureBytes(page);
    await page.click("#tabs [data-tab=compare]");
    const inputs = page.locator("#tab-compare input[type=file]");
    await inputs.nth(0).setInputFiles({ name: "before.xml", mimeType: "application/octet-stream", buffer: before });
    await inputs.nth(1).setInputFiles({ name: "after.xml", mimeType: "application/octet-stream", buffer: after });
    await page.click("#tab-compare button:has-text('Compare')");
    check((await page.textContent("#tab-compare")).includes("1 difference"), "one difference");
    await page.click("button:has-text('Select all shown')");
    await page.click("button:has-text('Copy selected changes')");
    await page.click(".modal-actions button:has-text('Copy')");
    equal(await page.evaluate(() => Model.getGlobal(App.save.doc, "G_Fame")), "999", "fame copied");
  });

  test("exports a character and imports it over another", async page => {
    await openFixture(page);
    const [file] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Export character')")]);
    const json = await downloadedBytes(file);
    await page.click(".pc-list button:nth-child(2)");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("button:has-text('Replace with imported')")]);
    await chooser.setFiles({ name: "c.json", mimeType: "application/json", buffer: json });
    await page.click(".modal-actions button:has-text('Replace')");
    await page.waitForFunction(() => Model.pcs(App.save.doc).map(p => Model.pcName(p)).join() === "Zoë & Co,Zoë & Co");
  });

  test("survives several open, edit and download cycles", async page => {
    let bytes = await fixtureBytes(page);
    for (let i = 1; i <= 4; i++) {
      await open(page, bytes);
      await page.fill("[data-focus=money] input", String(i * 100));
      const out = await download(page);
      equal(value(out.xml, "money"), String(i * 100), "money in cycle " + i);
      bytes = out.bytes;
    }
  });

  test("unapplied raw XML edits can't silently undo other edits", async page => {
    await openFixture(page);
    await page.fill("[data-focus=money] input", "1111");
    await page.selectOption("#viewSelect", "raw");
    await page.waitForFunction(() => (document.querySelector(".raw-fallback") || {}).value?.includes("<money>1111</money>"));
    await page.$eval(".raw-fallback", t => { t.value = t.value.replace("<difficulty>3</difficulty>", "<difficulty>2</difficulty>"); t.dispatchEvent(new Event("input")); });
    await page.click("#undoBtn");
    check(/haven't been applied/.test(await page.textContent(".modal")), "asks what to do with the raw edits");
    await page.click(".modal-actions button:has-text('Keep editing')");
    check((await page.inputValue(".raw-fallback")).includes("<difficulty>2</difficulty>"), "raw text kept");
    equal(await page.evaluate(() => text(App.save.doc.documentElement, "money")), "1111", "nothing undone yet");
    await page.click("#undoBtn");
    await page.click(".modal-actions button:has-text('Throw them away and undo')");
    equal(await page.evaluate(() => text(App.save.doc.documentElement, "money")), "5657", "undo ran");
    equal(await page.evaluate(() => text(App.save.doc.documentElement, "difficulty")), "3", "raw edit dropped");
  });

  test("Quick search applies pending raw edits first", async page => {
    await openFixture(page);
    await page.selectOption("#viewSelect", "raw");
    await page.waitForFunction(() => (document.querySelector(".raw-fallback") || {}).value?.includes("<money>5657</money>"));
    await page.$eval(".raw-fallback", t => { t.value = t.value.replace("<money>5657</money>", "<money>42</money>"); t.dispatchEvent(new Event("input")); });
    await page.keyboard.press("Control+k");
    await page.waitForSelector(".modal .picker input");
    await page.keyboard.type("med hypo");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => [...App.save.doc.querySelectorAll("hostInventory > item")].some(i => text(i, "templateName") === "ITM_Consumable_Healing_MedHypo"));
    await page.selectOption("#viewSelect", "simple");
    equal(await page.evaluate(() => text(App.save.doc.documentElement, "money")), "42", "raw edit kept");
    check(await page.evaluate(() => [...App.save.doc.querySelectorAll("hostInventory > item")].some(i => text(i, "templateName") === "ITM_Consumable_Healing_MedHypo")), "added item kept");
  });

  test("number boxes refuse values the game can't hold", async page => {
    await openFixture(page);
    const money = "[data-focus=money] input";
    await page.fill(money, "-5");
    check(await page.evaluate(() => text(App.save.doc.documentElement, "money")) === "5657", "negative money not written");
    await page.fill(money, "99999999999");
    check(await page.evaluate(() => text(App.save.doc.documentElement, "money")) === "5657", "huge money not written");
    await page.click("h1");
    equal(await page.inputValue(money), "5657", "box restored on leaving it");
    await page.fill(money, "");
    await page.click("h1");
    equal(await page.inputValue(money), "5657", "empty box restored");
  });

  test("Tree duplicates items with new uids and won't duplicate squad members", async page => {
    await openFixture(page);
    await page.selectOption("#viewSelect", "tree");
    await page.fill(".tree-tools input", "ITM_Scrap");
    await page.press(".tree-tools input", "Enter");
    await page.click(".results button.link");
    await page.evaluate(() => { const li = document.querySelector("li.flash"); li.parentElement.closest("li").querySelector(":scope > .node button[title=Duplicate]").click(); });
    const uids = await page.evaluate(() => [...App.save.doc.querySelectorAll("uid")].map(u => u.textContent));
    equal(new Set(uids).size, uids.length, "all uids unique");
    await page.fill(".tree-tools input", "companionId");
    await page.press(".tree-tools input", "Enter");
    await page.click(".results button.link");
    const pcHasDuplicate = await page.evaluate(() => { const li = document.querySelector("li.flash"); return !!li.parentElement.closest("li").querySelector(":scope > .node button[title=Duplicate]"); });
    check(!pcHasDuplicate, "no duplicate button on a squad member");
  });

  test("copies only what was ticked, after showing the list", async page => {
    await openFixture(page);
    const base = await page.evaluate(() => Fixtures.XML);
    const before = await fixtureBytes(page);
    const after = await fixtureBytes(page, base.replace("<k>G_Fame</k><v>107</v>", "<k>G_Fame</k><v>999</v>").replace("<money>5657</money>", "<money>1</money>"));
    await page.click("#tabs [data-tab=compare]");
    const inputs = page.locator("#tab-compare input[type=file]");
    await inputs.nth(0).setInputFiles({ name: "before.xml", mimeType: "application/octet-stream", buffer: before });
    await inputs.nth(1).setInputFiles({ name: "after.xml", mimeType: "application/octet-stream", buffer: after });
    await page.click("#tab-compare button:has-text('Compare')");
    await page.fill("#tab-compare input[type=search]", "fame");
    await page.click("button:has-text('Select all shown')");
    await page.fill("#tab-compare input[type=search]", "");
    await page.click("button:has-text('Copy selected changes')");
    check((await page.textContent(".modal-body")).includes("G_Fame"), "confirm lists the change");
    await page.click(".modal-actions button:has-text('Copy')");
    equal(await page.evaluate(() => Model.getGlobal(App.save.doc, "G_Fame")), "999", "fame copied");
    equal(await page.evaluate(() => text(App.save.doc.documentElement, "money")), "5657", "money not copied");
  });

  if (savePath) {
    test(`edits ${savePath} without touching anything else`, async page => {
      const bytes = fs.readFileSync(savePath);
      await open(page, bytes, "Real.xml");
      await page.fill("[data-focus=money] input", "4242");
      const out = await download(page);
      const diff = await page.evaluate(xml => {
        const a = new DOMParser().parseFromString(new TextDecoder().decode(App.save.originalXmlBytes), "application/xml");
        const b = new DOMParser().parseFromString(xml, "application/xml");
        return Model.diff(a, b).map(c => c.label);
      }, out.xml);
      equal(JSON.stringify(diff), JSON.stringify(["Money"]), "only money changed");
    });

    test(`round-trips ${savePath} without changes`, async page => {
      const bytes = fs.readFileSync(savePath);
      await open(page, bytes, "Real.xml");
      const original = await page.evaluate(() => new TextDecoder().decode(App.save.originalXmlBytes));
      const out = await download(page);
      check(out.xml === original, "downloaded XML differs from the original");
    });
  }

  return tests;
}
