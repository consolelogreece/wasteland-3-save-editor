// The form-based editor: overview, squad, inventory, Kodiak, collectibles, world.
"use strict";

const SimpleEditor = (() => {
  const INV_PER_PAGE = 50;
  const FLAGS_PER_PAGE = 50;
  const COLLECTION_PER_PAGE = 50;
  const VIEWS = [
    ["squad", "Squad"],
    ["inventory", "Inventory"],
    ["kodiak", "Kodiak"],
    ["collectibles", "Collectibles"],
    ["world", "World & story"],
  ];

  let root, selectedPc = 0, view = "squad";
  let invFilter = "", invCategory = "", invPage = 0, addQty = 1;
  let flagFilter = "", flagPage = 0;
  let pendingFocus = null;
  const openDetails = new Set();
  const collectionState = {};

  const doc = () => App.save.doc;
  const save = () => doc().documentElement;
  const changed = key => App.changed("simple", key);

  function done(message) {
    changed();
    render();
    if (message) toast(message, { undo: true });
  }

  // Fields

  // Only whole numbers in [min, max] are written. Anything else is marked and
  // reverted on blur.
  function numberInput(value, onValue, opts = {}) {
    const min = opts.min ?? Model.INT_MIN, max = opts.max ?? Model.INT_MAX;
    let last = String(value);
    const input = el("input", { type: "number", value, min, max, step: 1, placeholder: opts.placeholder });
    const soft = opts.softMax === undefined ? null
      : el("span.warn", { hidden: !(+value > opts.softMax) }, "game max is " + opts.softMax);
    const error = el("span.warn", { hidden: true });

    const clearError = () => { input.classList.remove("invalid"); error.hidden = true; };
    input.addEventListener("input", () => {
      const v = input.value.trim();
      const n = Number(v);
      const whole = /^-?\d+$/.test(v);
      const ok = whole && n >= min && n <= max;
      input.classList.toggle("invalid", !ok && v !== "");
      error.hidden = ok || v === "";
      error.textContent = !whole ? "whole numbers only" : n < min ? "lowest is " + min : "highest is " + max;
      if (soft) soft.hidden = !(ok && n > opts.softMax);
      if (!ok) return;
      last = String(n);
      if (onValue(last) !== false) changed(input);
    });
    input.addEventListener("blur", () => {
      if (input.value.trim() !== last) { input.value = last; clearError(); }
    });
    input.showValue = v => {
      last = String(v);
      input.value = last;
      clearError();
      if (soft) soft.hidden = !(+v > opts.softMax);
    };
    return { input, notes: [soft, error].filter(Boolean) };
  }

  function field(label, { input, notes }, focus = "") {
    return el("label.field", { dataset: { focus } }, el("span.label", label), input, notes);
  }

  function numField(label, node, tag, opts = {}) {
    const write = v => {
      setText(node, tag, v);
      if (opts.after) opts.after(v);
    };
    return field(label, numberInput(text(node, tag), write, opts), opts.focus);
  }

  // Story flags can appear in more than one place at once (e.g. Fame), so
  // every box for the same flag is kept showing the same value.
  function globalInput(key, value) {
    const made = numberInput(value ?? "", v => {
      const result = Model.setGlobal(doc(), key, v);
      for (const other of document.querySelectorAll(`input[data-global="${CSS.escape(key)}"]`)) {
        if (other !== made.input) other.showValue(v);
      }
      return result;
    }, { placeholder: "not set" });
    made.input.dataset.global = key;
    return made;
  }

  function globalField(label, key) {
    return field(label, globalInput(key, Model.getGlobal(doc(), key)), key);
  }

  function scrapField() {
    const write = v => {
      Model.setScrap(doc(), +v);
      if (view === "inventory") requestAnimationFrame(render);
    };
    return field("Scrap", numberInput(String(Model.getScrap(doc())), write, { min: 0 }), "scrap");
  }
  function showScrapTotal() {
    const box = root.querySelector('[data-focus="scrap"] input');
    if (box && box !== document.activeElement) box.showValue(Model.getScrap(doc()));
  }

  // Layout

  // Re-renders and puts focus back, found by data-key or data-focus.
  function keepFocus(container, redraw) {
    const active = document.activeElement;
    let selector = null;
    if (active && container.contains(active)) {
      const holder = active.closest("[data-focus]");
      if (active.dataset.key) selector = `[data-key="${CSS.escape(active.dataset.key)}"]`;
      else if (holder && holder.dataset.focus) selector = `[data-focus="${CSS.escape(holder.dataset.focus)}"] input`;
    }
    redraw();
    const again = selector && container.querySelector(selector);
    if (again) again.focus({ preventScroll: true });
  }

  function card(title, ...kids) {
    return el("section.card", { dataset: { section: title } }, el("h3", title), ...kids);
  }

  function collapsible(id, title, ...kids) {
    const box = el("details.card", { open: openDetails.has(id) }, el("summary", el("h3", title)), ...kids);
    box.addEventListener("toggle", () => (box.open ? openDetails.add(id) : openDetails.delete(id)));
    return box;
  }

  function chips(codes, onRemove, empty = "None.") {
    if (!codes.length) return el("p.muted", empty);
    return el("div.chips", codes.map(code => el("span.chip", { title: code },
      el("a", { href: wikiUrl(displayName(code)), target: "_blank", rel: "noopener", title: code }, displayName(code)),
      onRemove && el("button", { type: "button", title: "Remove " + displayName(code), onclick: () => onRemove(code) }, "✕"))));
  }

  function smallButton(label, onclick) {
    return el("button.btn.small", { type: "button", onclick }, label);
  }

  function goSection(title, focus) {
    const section = root.querySelector(`[data-section="${CSS.escape(title)}"]`);
    const target = focus && section && section.querySelector(`[data-focus="${CSS.escape(focus)}"]`);
    showSection(section, target);
  }
  const toSection = (label, title, focus) => jumpLink(label, () => goSection(title, focus));
  const toView = (label, name) => jumpLink(label, () => {
    view = name;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // A warning that redraws in place, so typing in a box doesn't lose focus.
  function liveWarning(build) {
    const box = el("div.live-warning");
    const refresh = () => {
      const warning = build();
      box.replaceChildren(...(warning ? [warning] : []));
    };
    refresh();
    return { box, refresh };
  }

  function pagedList(container, items, page, perPage, setPage, renderRows, empty) {
    const nav = () => pager(items.length, page, perPage, setPage);
    const rows = items.length ? renderRows(pageItems(items, page, perPage)) : el("p.muted", empty);
    container.replaceChildren(...[nav(), rows, nav()].filter(Boolean));
  }

  // The character as they were when the save was opened, or null. Comparing
  // with this keeps the warnings right through undo and raw edits.
  function openedPc(pc) {
    const id = Model.pcIdentity(pc), opened = Changes.original();
    if (!id || !opened) return null;
    const matches = Model.pcs(opened).filter(p => Model.pcIdentity(p) === id);
    return matches.length === 1 ? matches[0] : null;
  }

  // Render

  function render(container) {
    root = container || root;
    if (!App.save) { root.replaceChildren(); return; }
    const s = save();
    const scene = text(s, "currentScene");

    const overview = el("section.card.overview",
      el("div.stat", el("span.label", "Location"), el("strong", { title: scene }, locationName(scene) || "?")),
      el("div.stat", el("span.label", "Saved"), el("strong", formatSaveTime(text(s, "saveTime")))),
      numField("Money ($)", s, "money", { min: 0, focus: "money" }),
      scrapField(),
      ...Model.PARTY_STATS.map(stat => globalField(stat.label, stat.key)));

    const nav = el("div.subtabs", { role: "tablist" }, VIEWS.map(([name, label]) => el("button", {
      type: "button", role: "tab", "aria-selected": String(view === name), class: view === name ? "active" : "",
      dataset: { key: "view-" + name }, onclick: () => { view = name; render(); },
    }, label)));

    const renderers = {
      squad: renderSquad, inventory: renderInventory, kodiak: renderKodiak,
      collectibles: renderCollectibles, world: renderWorld,
    };
    const body = renderers[view]();
    keepFocus(root, () => root.replaceChildren(overview, nav, body));

    if (pendingFocus) {
      const target = root.querySelector(`[data-focus="${CSS.escape(pendingFocus)}"]`);
      pendingFocus = null;
      if (target) requestAnimationFrame(() => flash(target));
    }
  }

  function formatSaveTime(t) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2}):(\d{2})/.exec(t || "");
    return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : t || "?";
  }

  // Squad

  function renderSquad() {
    const pcs = Model.pcs(doc());
    if (!pcs.length) return el("p.muted", "No squad members found in this save.");
    if (selectedPc >= pcs.length) selectedPc = 0;
    const list = el("div.pc-list", pcs.map((pc, i) => el("button", {
      type: "button", class: i === selectedPc ? "active" : "", dataset: { key: "pc-" + i },
      onclick: () => { selectedPc = i; render(); },
    }, el("strong", Model.pcName(pc, i)), el("span.muted", "Level " + text(pc, "level")))));
    return el("div.squad", list, renderPc(pcs[selectedPc], selectedPc));
  }

  function renderPc(pc, i) {
    const name = Model.pcName(pc, i);
    const head = el("div.pc-head",
      el("h2", name),
      el("div.pc-actions",
        el("button.btn", { type: "button", onclick: () => exportPc(pc) }, "Export character"),
        el("button.btn", { type: "button", onclick: () => importOver(pc, name) }, "Replace with imported…")));

    return el("div.pc-detail",
      head, renderBasics(pc), renderAttributes(pc, name), renderSkills(pc), renderPerks(pc),
      renderMutations(pc), renderEquipment(pc), renderAbilities(pc));
  }

  function renderBasics(pc) {
    const opened = openedPc(pc);
    const levelFrom = opened ? +text(opened, "level") : null;
    const warning = liveWarning(() => {
      const level = +text(pc, "level");
      if (levelFrom === null || !(level > levelFrom)) return null;
      const putBack = () => {
        setText(pc, "level", String(levelFrom));
        done(`Put Level back to ${levelFrom}.`);
      };
      return caution(`Level raised from ${levelFrom} to ${level}.`,
        "That doesn't give the attribute, skill and perk points levelling up would. Add them below, then spend them in game. ",
        smallButton("Put the old level back", putBack));
    });

    return card("Basics",
      warning.box,
      el("div.grid",
        numField("Level", pc, "level", { min: 1, after: level => {
          warning.refresh();
          const listed = root.querySelector(".pc-list .active .muted");
          if (listed) listed.textContent = "Level " + level;
        } }),
        numField("XP", pc, "xp", { min: 0 }),
        numField("Hit points", pc, "hitpoints", { min: 1 }),
        numField("Unspent attribute points", pc, "availableAttributePoints", { min: 0, focus: "attrpoints" }),
        numField("Unspent skill points", pc, "availableSkillPoints", { min: 0, focus: "skillpoints" }),
        numField("Unspent perk points", pc, "perkPoints", { min: 0, focus: "perkpoints" })),
      el("p.hint", "Changing Level doesn't give any points. To change a build properly, give unspent points and spend them in game."));
  }

  function renderAttributes(pc, name) {
    const capitalise = s => s[0].toUpperCase() + s.slice(1);
    const setAll = () => {
      if (Model.setAllAttributes(pc, 10)) done(`Set all of ${name}'s attributes to 10`);
    };
    return card("Attributes",
      el("div.grid.attrs", Model.ATTRIBUTES.map(a => numField(capitalise(a), pc, a, { min: 1, softMax: 10 }))),
      el("div.row-actions", el("button.btn", { type: "button", dataset: { key: "set-all-10" }, onclick: setAll }, "Set all to 10")));
  }

  function exportPc(pc) {
    const json = Model.exportCharacter(pc);
    const fileName = Model.pcName(pc).replace(/[^\w.-]+/g, "_") || "character";
    saveBlob(new Blob([json], { type: "application/json" }), fileName + ".w3char.json");
    toast("Exported " + Model.pcName(pc));
  }

  function importOver(pc, name) {
    const input = el("input", { type: "file", accept: ".json,application/json" });
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const json = await file.text();
      let check;
      try { check = Model.checkImport(doc(), json, pc); } catch (e) { banner(e.message); return; }

      const replace = () => {
        try {
          Model.importCharacter(doc(), json, pc);
          done(`Replaced ${name} with ${check.name}`);
        } catch (e) { banner(e.message); }
      };
      modal(`Replace ${name} with ${check.name}?`, el("div",
        el("p", `${check.name} takes ${name}'s place in the squad and on the map.`),
        check.warnings.map(w => el("p.notice.warn-box", w)),
        el("p.hint", "Export the current character first if you might want them back. You can also undo afterwards.")),
      [{ label: "Replace", primary: true, onClick: replace }, { label: "Cancel", onClick: () => {} }]);
    };
    input.click();
  }

  function renderSkills(pc) {
    const rows = children(child(pc, "skills"), "skill");
    const skillId = row => text(row, "skillId");
    const skillName = row => Model.SKILLS[skillId(row)] || "Unknown skill";
    const opened = openedPc(pc);
    const openedSkill = row => Model.findSkill(opened, skillId(row));
    const levelFrom = row => (openedSkill(row) ? +text(openedSkill(row), "level") : 0);
    const raised = () => (opened ? rows.filter(row => row.parentNode && +text(row, "level") > levelFrom(row)) : []);

    const putBack = () => {
      for (const row of raised()) {
        if (openedSkill(row)) setText(row, "level", String(levelFrom(row)));
        else row.remove();
      }
      done("Skill levels put back. Add skill points here and spend them in game.");
      goSection("Basics", "skillpoints");
    };
    const warning = liveWarning(() => {
      const list = raised();
      if (!list.length) return null;
      const lead = list.length === 1
        ? `${skillName(list[0])} raised from ${levelFrom(list[0])} to ${text(list[0], "level")}.`
        : `${list.length} skills raised: ${list.map(skillName).join(", ")}.`;
      return caution(lead, "That won't unlock the crafting recipes or perk slots that come with those levels. ",
        smallButton("Undo and give skill points instead", putBack));
    });

    const table = el("div.rows", rows.map(row => el("div.row",
      el("span.grow", el("strong", skillName(row)), el("span.code", "skill id " + skillId(row))),
      numField("Level", row, "level", { min: 0, softMax: 10, after: warning.refresh }),
      el("button.icon", { type: "button", title: "Remove skill", onclick: () => { row.remove(); done(); } }, "✕"))));

    const have = new Set(rows.map(skillId));
    const missing = Object.entries(Model.SKILLS)
      .filter(([id]) => !have.has(id))
      .map(([id, name]) => ({
        value: id, name,
        sub: id === Model.COMBAT_SHOOTING ? "Hidden skill, normally learned from a skill book" : "",
      }));
    const picker = codePicker({
      entries: missing, placeholder: "Find a skill…", addLabel: "Add skill",
      onPick: id => { Model.setSkill(pc, id, 1); done(); },
    });

    return card("Skills",
      el("p.hint", "Raising a skill here doesn't unlock its recipes or perk slots. Giving skill points in ",
        toSection("Basics", "Basics", "skillpoints"), " and spending them in game does."),
      warning.box,
      rows.length ? table : el("p.muted", "No skills yet."),
      missing.length ? picker : null);
  }

  function renderPerks(pc) {
    const perkNames = node => children(child(node, "perks"), "perk").map(p => text(p, "perkname"));
    const perks = perkNames(pc);
    const allCodes = metaData["Quirks Perks and Backgrounds"];

    const singleSelect = (label, prefix) => {
      const value = perks.find(p => p.startsWith(prefix)) || "";
      const options = allCodes.filter(c => c.startsWith(prefix));
      if (value && !options.includes(value)) options.push(value);
      options.sort((a, b) => displayName(a).localeCompare(displayName(b)));
      const select = el("select", el("option", { value: "" }, "None"),
        options.map(c => el("option", { value: c, selected: c === value }, displayName(c))));
      select.onchange = () => { if (Model.setSinglePerk(pc, prefix, select.value)) done(); };
      return el("label.field", el("span.label", label), select);
    };

    const normal = perks.filter(p => !/^(BCK|QRK)_/.test(p));
    const picker = codePicker({
      entries: allCodes.filter(c => c.startsWith("PRK_") && !perks.includes(c) && !Model.isDevCode(c)),
      placeholder: "Find a perk, e.g. rally, healthy…",
      thumbs: true,
      addLabel: "Add perk",
      onPick: code => {
        const { added, ability } = Model.addPerk(pc, code);
        if (!added) return;
        done(ability ? `Added ${displayName(code)} and its ability ${displayName(ability)}` : `Added ${displayName(code)}`);
      },
    });
    const remove = code => {
      const { ability } = Model.removePerk(pc, code);
      done(ability ? `Removed ${displayName(code)} and its ability` : `Removed ${displayName(code)}`);
    };

    const opened = openedPc(pc);
    const openedPerks = new Set(opened ? perkNames(opened) : []);
    const added = opened ? normal.filter(c => !openedPerks.has(c)) : [];
    const one = added.length === 1;
    const swapForPoints = () => {
      for (const code of added) Model.removePerk(pc, code);
      setText(pc, "perkPoints", String(Math.min(Model.INT_MAX, +text(pc, "perkPoints") + added.length)));
      done(`Removed ${one ? displayName(added[0]) : added.length + " perks"} and gave ${added.length} perk point${one ? "" : "s"}`);
      goSection("Basics", "perkpoints");
    };
    const warning = added.length ? caution(
      one ? `${displayName(added[0])} skips the game's requirements.` : `${added.length} perks skip the game's requirements.`,
      "No skill level check, and no perk point spent. ",
      smallButton(one ? "Swap it for a perk point" : `Swap them for ${added.length} perk points`, swapForPoints)) : null;

    return card("Background, quirk & perks",
      el("p.hint", "Perks added here skip the skill requirement and cost no perk point. Ones with an active ability (like Rally) add it too. Or give perk points in ",
        toSection("Basics", "Basics", "perkpoints"), " and pick perks in game."),
      warning,
      el("div.grid", singleSelect("Background", "BCK_"), singleSelect("Quirk", "QRK_")),
      el("span.label", `Perks (${normal.length})`),
      chips(normal, remove),
      picker);
  }

  function renderMutations(pc) {
    const effects = Model.statusEffects(pc).map(s => text(s, "name"));
    const mutationCodes = new Set(Model.MUTATIONS.map(m => m.code));
    const toggles = el("div.toggles", Model.MUTATIONS.map(m => {
      const on = effects.includes(m.code);
      const toggle = () => {
        if (on) Model.removeStatusEffect(pc, m.code);
        else Model.addStatusEffect(pc, m.code);
        done();
      };
      return el("button.toggle", {
        type: "button", class: (on ? "on " : "") + (m.good ? "good" : "bad"), "aria-pressed": String(on),
        dataset: { key: "mut-" + m.code }, onclick: toggle,
      }, el("strong", m.name), el("span", m.effect));
    }));

    const others = effects.filter(c => !mutationCodes.has(c));
    const picker = codePicker({
      entries: metaData["Status Effects"].filter(c => !effects.includes(c) && !Model.isDevCode(c)),
      placeholder: "Find another status effect, e.g. spirit animal…",
      thumbs: true,
      addLabel: "Add effect",
      onPick: code => { Model.addStatusEffect(pc, code); done("Added " + displayName(code)); },
    });

    return card("Mutations & status effects",
      el("p.hint", "Click to add or remove. Green are good, red are bad."),
      toggles,
      el("span.label", "Other status effects"),
      chips(others, code => { Model.removeStatusEffect(pc, code); done(); }),
      picker,
      el("p.hint", "Animal companion bonuses also live here (e.g. Spirit Animal effects)."));
  }

  function renderAbilities(pc) {
    const list = Model.abilities(pc).map(a => a.textContent);
    const aimedShot = code => code.startsWith("ABL_PrecisionStrike_");
    const shown = list.filter(c => !aimedShot(c));
    const aimedShots = list.length - shown.length;
    return collapsible("abilities", `Abilities (${shown.length})`,
      el("p.hint", "Most abilities come from perks and gear.",
        aimedShots ? ` The ${aimedShots} aimed-shot targets (head, legs, CPU and so on) every character gets aren't listed.` : ""),
      chips(shown, code => { Model.removeAbility(pc, code); done(); }),
      codePicker({
        entries: metaData.Abilities.filter(c => !list.includes(c) && !Model.isDevCode(c)),
        placeholder: "Find an ability…",
        thumbs: true,
        addLabel: "Add ability",
        onPick: code => { Model.addAbility(pc, code); done(); },
      }));
  }

  function itemLine(item) {
    const code = text(item, "templateName");
    const mods = children(child(item, "mods"), "mod").map(m => displayName(m.textContent));
    return [
      wikiThumb(displayName(code)),
      el("span.grow",
        el("span", el("strong", displayName(code)), " ", wikiLink(displayName(code))),
        el("span.code", code),
        mods.length ? el("span.hint", "Mods: " + mods.join(", ")) : null),
    ];
  }

  // Opens a dialog with a code picker; pick(value) returns true to close it.
  function pickerDialog(title, hint, pickerOpts, pick) {
    const dialog = modal(title, el("div",
      el("p.hint", hint),
      codePicker({ ...pickerOpts, onPick: value => { if (pick(value)) { dialog.close(); render(); } } })));
  }

  function renderEquipment(pc) {
    const gearRows = Model.GEAR_SLOTS.map(def => {
      const item = Model.equipped(pc, def.slot);
      const choose = () => {
        const inventory = children(child(save(), "hostInventory"), "item");
        const owned = inventory.filter(i => def.accepts.test(text(i, "templateName")));
        const entries = [
          ...owned.map(i => ({
            value: { item: i }, code: text(i, "templateName"), name: displayName(text(i, "templateName")),
            sub: `In inventory (${text(i, "quantity")})`, rank: 0,
          })),
          ...metaData.Items
            .filter(c => def.accepts.test(c) && !Model.isDevCode(c))
            .map(c => ({ value: { code: c }, code: c, rank: 1 })),
        ];
        pickerDialog("Equip: " + def.label,
          "Your own items are listed first. Anything else is created new. What's in the slot now goes to the inventory.",
          { entries, placeholder: "Search by name or code", thumbs: true },
          pick => {
            try {
              const equipped = pick.item ? Model.equip(pc, def.slot, pick.item) : Model.equipNew(pc, def.slot, pick.code);
              changed();
              toast("Equipped " + displayName(text(equipped, "templateName")), { undo: true });
              return true;
            } catch (e) { toast(e.message); return false; }
          });
      };
      const unequip = () => { Model.unequip(pc, def.slot); done("Moved to inventory"); };
      return el("div.row",
        el("span.slot-label", def.label),
        ...(item ? itemLine(item) : [el("span.thumb-empty"), el("span.grow.muted", "Empty")]),
        el("button.btn", { type: "button", dataset: { key: "equip-" + def.slot }, onclick: choose }, item ? "Change…" : "Equip…"),
        item ? el("button.btn", { type: "button", dataset: { key: "unequip-" + def.slot }, onclick: unequip }, "Unequip") : null);
    });

    const gearSlots = new Set(Model.GEAR_SLOTS.map(d => String(d.slot)));
    const cosmetics = children(child(pc, "equipment"), "item")
      .filter(i => !gearSlots.has(text(i, "slot")))
      .sort((a, b) => +text(a, "slot") - +text(b, "slot"));
    const cosmeticRows = cosmetics.map(item => {
      const slot = text(item, "slot");
      const options = Model.outfitOptions(pc, item);
      const swap = () => pickerDialog("Outfit: " + Model.slotLabel(slot),
        "Only pieces for the same body part and body type are listed.",
        { entries: options, placeholder: "Search outfits…" },
        code => {
          setText(item, "templateName", code);
          changed();
          toast("Changed to " + displayName(code), { undo: true });
          return true;
        });
      return el("div.row",
        el("span.slot-label", Model.slotLabel(slot)),
        ...itemLine(item),
        options ? el("button.btn", { type: "button", dataset: { key: "outfit-" + slot }, onclick: swap }, "Change…") : null);
    });

    return card("Equipment",
      el("div.rows", gearRows),
      collapsible("cosmetics", `Outfit, appearance & quick slots (${cosmetics.length})`,
        el("div.rows", cosmeticRows),
        el("p.hint", "Head, hair, face and quick slots can only be changed in game.")));
  }

  // Inventory

  let inventoryCodeList = null;
  // Collectibles and outfits are left out: the game doesn't keep them in the inventory.
  function inventoryCodes() {
    inventoryCodeList ??= metaData.Items.filter(c => Model.isInventoryCode(c) && !Model.isDevCode(c));
    return inventoryCodeList;
  }

  function renderInventory() {
    const items = children(child(save(), "hostInventory"), "item");

    const qty = el("input.qty", { type: "number", value: addQty, min: 1, step: 1, "aria-label": "Quantity to add" });
    qty.oninput = () => (addQty = +Model.clampInt(qty.value || 1, 1));
    const presets = [1, 10, 100].map(n => smallButton("×" + n, () => { addQty = n; qty.value = n; }));
    const picker = codePicker({
      entries: inventoryCodes(), placeholder: "Find an item, e.g. medic pack, sniper rifle…",
      thumbs: true, addLabel: "Add to inventory", onPick: code => addItem(code),
    });
    picker.id = "inventory-picker";

    const categories = ["", ...Model.ITEM_CATEGORIES.map(c => c[0]), "Other"];
    const categorySelect = el("select", { "aria-label": "Category" },
      categories.map(c => el("option", { value: c, selected: c === invCategory }, c || "All categories")));
    const filter = el("input", { type: "search", placeholder: `Filter ${items.length} items…`, value: invFilter });
    const listWrap = el("div");

    const draw = () => {
      const f = invFilter.toLowerCase();
      const shown = items.filter(i => {
        const code = text(i, "templateName");
        if (invCategory && Model.itemCategory(code) !== invCategory) return false;
        return !f || code.toLowerCase().includes(f) || displayName(code).toLowerCase().includes(f);
      });
      invPage = Math.min(invPage, lastPage(shown.length, INV_PER_PAGE));
      const setPage = n => { invPage = n; draw(); listWrap.scrollIntoView({ block: "start" }); };
      pagedList(listWrap, shown, invPage, INV_PER_PAGE, setPage, itemRows, "No matching items.");
    };
    filter.oninput = () => { invFilter = filter.value; invPage = 0; draw(); };
    categorySelect.onchange = () => { invCategory = categorySelect.value; invPage = 0; draw(); };
    draw();

    return el("div",
      card("Add items",
        el("div.add-row", el("label.qty-wrap", el("span.label", "Qty"), qty), ...presets),
        picker,
        el("p.hint", "Outfits, tapes, dolls, Kodiak parts and recipes are under ", toView("Collectibles", "collectibles"), ".")),
      card("Items", el("div.filters", filter, categorySelect), listWrap));
  }

  function addItem(code, qty = addQty) {
    if (!Model.isInventoryCode(code)) { showCollectible(code); return; }
    const added = Model.isStackable(code) ? qty : Math.min(qty, Model.MAX_COPIES);
    Model.addInventoryItem(doc(), code, qty);
    App.changed("inventory");
    const unknown = metaData.Items.includes(code) ? "" : " (not a known code, so check it's right)";
    const capped = added < qty ? ` (${Model.MAX_COPIES} at most at a time, as it doesn't stack)` : "";
    toast(`Added ${added} × ${displayName(code)}${capped}${unknown}`, { undo: true });
  }

  function itemRows(items) {
    return el("div.rows", items.map(item => {
      const code = text(item, "templateName");
      const notInInventory = !Model.isInventoryCode(code) && el("span.warn-chip", {
        title: "This is a collectible or outfit, which the game doesn't keep in the inventory. Delete it and tick it under Collectibles instead.",
      }, "Not shown in game");
      const duplicate = () => { Model.duplicateItem(item); done(); };
      const remove = () => { item.remove(); done("Deleted " + displayName(code)); };
      const qty = text(item, "quantity");
      const split = () => {
        const made = Model.splitStack(item);
        const left = parseInt(text(item, "quantity"), 10) - 1;
        done(`Split into ${made} separate items` + (left > 0 ? `. ${left} more still to split` : ""));
      };
      const afterQty = code === "ITM_Scrap" ? showScrapTotal : undefined;
      const quantity = Model.isStackable(code) ? numField("Qty", item, "quantity", { min: 1, after: afterQty })
        : qty === "1" ? el("span.field.muted", { title: "Doesn't stack. Each one is a separate item." }, "×1")
        : el("button.btn.small", { type: "button", title: "This doesn't stack in game, so only one would show.", onclick: split }, `Split ×${qty} into separate items`);
      return el("div.row",
        ...itemLine(item),
        notInInventory,
        quantity,
        el("button.icon", { type: "button", title: "Duplicate", onclick: duplicate }, "⧉"),
        el("button.icon", { type: "button", title: "Delete", onclick: remove }, "✕"));
    }));
  }

  // Kodiak

  function renderKodiak() {
    const cars = Model.cars(doc());
    if (!cars.length) return el("p.muted", "No vehicles in this save.");
    return el("div", cars.map((car, i) => {
      const parts = children(child(car, "equipment"), "item").sort((a, b) => +text(a, "slot") - +text(b, "slot"));
      const partRows = parts.map(part => {
        const slot = text(part, "slot");
        const def = Model.vehicleSlot(slot);
        const swap = () => pickerDialog("Kodiak: " + def.label, "Pick a replacement part.",
          { entries: metaData.Items.filter(c => def.accepts.test(c) && !Model.isDevCode(c)), placeholder: "Search parts…", thumbs: true },
          code => {
            try { Model.setVehiclePart(part, code); } catch (e) { toast(e.message); return false; }
            changed();
            toast("Fitted " + displayName(code), { undo: true });
            return true;
          });
        return el("div.row",
          el("span.slot-label", def.label),
          ...itemLine(part),
          el("button.btn", { type: "button", dataset: { key: `kodiak-${i}-${slot}` }, onclick: swap }, "Change…"));
      });
      return card(Model.carName(car, i),
        el("div.grid", numField("Hit points", car, "hp", { min: 1 }), numField("Paint colour", car, "tintColor", { min: 0 })),
        el("div.rows", partRows),
        i === 0 ? el("p.hint", "The save's list of unlocked Kodiak parts is under ", toView("Collectibles", "collectibles"), ".") : null);
    }));
  }

  // Collectibles: a checklist per collection. Ticking adds, unticking removes.

  const stateFor = key => (collectionState[key] ??= { filter: "", show: "all", page: 0, open: new Set() });

  function renderCollectibles() {
    return el("div",
      el("p.hint", "Outfits are worn from the barracks at Ranger HQ."),
      Model.COLLECTIONS.map(def => (def.key === "appearances" ? outfitChecklist(def) : checklist(def))));
  }

  function collectionCard(def, count, body) {
    const id = "col-" + def.key;
    const onToggle = e => (e.target.open ? openDetails.add(id) : openDetails.delete(id));
    return el("details.card", { open: openDetails.has(id), dataset: { focus: id }, ontoggle: onToggle },
      el("summary", el("h3", def.label), count), body);
  }

  function filterBar(state, placeholder, redraw, extra) {
    const search = el("input", { type: "search", placeholder, value: state.filter });
    search.oninput = () => { state.filter = search.value; state.page = 0; redraw(); };
    const showOptions = [["all", "All"], ["have", "Ticked"], ["missing", "Not ticked"]];
    const show = el("select", { "aria-label": "Show" },
      showOptions.map(([value, label]) => el("option", { value, selected: state.show === value }, label)));
    show.onchange = () => { state.show = show.value; state.page = 0; redraw(); };
    return el("div.filters", search, show, extra);
  }

  const matchesWords = (filter, haystack) => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return words.every(w => haystack.toLowerCase().includes(w));
  };

  function checkbox(checked, key, onChange) {
    const box = el("input", { type: "checkbox", checked, dataset: { key } });
    box.onchange = () => onChange(box.checked, box);
    return box;
  }

  function checklist(def) {
    const state = stateFor(def.key);
    const all = [...new Set([...def.all(), ...Model.getCollection(doc(), def)])];
    const count = el("span.count");
    const listWrap = el("div");
    const tickAll = def.noAddAll ? null : el("button.btn", { type: "button" });
    const tickShown = el("button.btn", { type: "button", hidden: true });
    let shown = [];

    const toggle = (code, on, box) => {
      if (on) Model.addToCollection(doc(), def, code);
      else Model.removeFromCollection(doc(), def, code);
      changed(box);
      redraw();
    };
    const rows = codes => {
      const have = new Set(Model.getCollection(doc(), def));
      return el("div.rows", codes.map(code => el("label.row.check-row", { dataset: { code } },
        checkbox(have.has(code), "col-" + code, (on, box) => toggle(code, on, box)),
        wikiThumb(displayName(code)),
        el("span.grow", el("strong", displayName(code)), el("span.code", code)))));
    };

    function redraw() {
      const have = new Set(Model.getCollection(doc(), def));
      count.textContent = ` ${have.size} of ${all.length}`;
      if (tickAll) {
        tickAll.textContent = `Tick all ${all.length}`;
        tickAll.disabled = have.size === all.length;
      }
      shown = all.filter(code => {
        if (state.show === "have" && !have.has(code)) return false;
        if (state.show === "missing" && have.has(code)) return false;
        return matchesWords(state.filter, displayName(code) + " " + code);
      });
      const untickedShown = shown.filter(c => !have.has(c)).length;
      tickShown.hidden = !state.filter.trim() || !untickedShown;
      tickShown.textContent = `Tick the ${untickedShown} shown`;
      state.page = Math.min(state.page, lastPage(shown.length, COLLECTION_PER_PAGE));
      const setPage = n => { state.page = n; redraw(); };
      keepFocus(listWrap, () => pagedList(listWrap, shown, state.page, COLLECTION_PER_PAGE, setPage, rows, "Nothing matches."));
    }

    const tick = codes => {
      const n = Model.addToCollection(doc(), def, codes);
      changed();
      redraw();
      toast(`Ticked ${n} ${def.label.toLowerCase()}`, { undo: true });
    };
    if (tickAll) tickAll.onclick = () => tick(all);
    tickShown.onclick = () => tick(shown);
    redraw();

    return collectionCard(def, count, el("div",
      def.note ? el("p.hint", def.note) : null,
      filterBar(state, `Filter ${def.label.toLowerCase()}…`, redraw, [tickShown, tickAll].filter(Boolean)),
      listWrap));
  }

  function outfitChecklist(def) {
    const state = stateFor(def.key);
    const sets = Model.outfitSets(doc());
    const count = el("span.count");
    const listWrap = el("div");

    const setPieces = (pieces, on, box) => {
      if (on) Model.addToCollection(doc(), def, pieces);
      else for (const piece of pieces) Model.removeFromCollection(doc(), def, piece);
      changed(box);
      redraw();
    };
    const setRow = (set, have) => {
      const owned = set.pieces.filter(p => have.has(p)).length;
      const box = checkbox(owned === set.pieces.length, "set-" + set.key, (on, b) => setPieces(set.pieces, on, b));
      box.indeterminate = owned > 0 && owned < set.pieces.length;
      const isOpen = state.open.has(set.key);
      const toggleOpen = () => {
        if (isOpen) state.open.delete(set.key);
        else state.open.add(set.key);
        redraw();
      };
      const pieces = isOpen && el("div.pieces", set.pieces.map(code => el("label.check-row.piece",
        checkbox(have.has(code), "piece-" + code, (on, b) => setPieces([code], on, b)),
        el("span", prettyCode(code)),
        el("span.code", code))));
      const plural = set.pieces.length === 1 ? "" : "s";
      return el("div.outfit-set", { dataset: { set: set.key } },
        el("div.row",
          el("label.check-row.grow", box, el("strong", set.name), el("span.muted", ` ${owned} of ${set.pieces.length} piece${plural}`)),
          el("button.btn.small", { type: "button", "aria-expanded": String(isOpen), dataset: { key: "open-" + set.key }, onclick: toggleOpen },
            isOpen ? "Hide pieces" : "Pieces")),
        pieces || null);
    };

    function redraw() {
      const have = new Set(Model.getCollection(doc(), def));
      const ownedSets = sets.filter(set => set.pieces.some(p => have.has(p))).length;
      count.textContent = ` ${ownedSets} of ${sets.length} outfits`;
      const shown = sets.filter(set => {
        const owned = set.pieces.filter(p => have.has(p)).length;
        if (state.show === "have" && !owned) return false;
        if (state.show === "missing" && owned === set.pieces.length) return false;
        return matchesWords(state.filter, `${set.name} ${set.key} ${set.pieces.join(" ")}`);
      });
      state.page = Math.min(state.page, lastPage(shown.length, COLLECTION_PER_PAGE));
      const setPage = n => { state.page = n; redraw(); };
      const rows = page => el("div.rows", page.map(set => setRow(set, have)));
      keepFocus(listWrap, () => pagedList(listWrap, shown, state.page, COLLECTION_PER_PAGE, setPage, rows, "Nothing matches."));
    }
    redraw();

    return collectionCard(def, count, el("div",
      filterBar(state, "Filter outfits, e.g. elf, ranger…", redraw),
      el("p.hint", "Outfits are grouped by the start of their code, so a few sets include pieces only NPCs wear."),
      listWrap));
  }

  function showCollectible(code) {
    const showIn = (key, filter, openSet) => {
      const state = stateFor(key);
      state.filter = filter;
      state.show = "all";
      state.page = 0;
      if (openSet) state.open.add(openSet);
      goto({ view: "collectibles", open: "col-" + key, focus: "col-" + key });
    };

    if (Model.isOutfitItem(code)) {
      const set = Model.outfitSetForItem(code);
      showIn("appearances", set || displayName(code).replace(/ Outfit$| Suit$/i, ""), set);
      if (!set) toast(`${displayName(code)}'s pieces aren't known, so it may not be listed.`);
      return;
    }
    const def = Model.collectionFor(code);
    if (def) { showIn(def.key, code); return; }
    if (Model.collection("appearances").all().includes(code)) {
      const set = Model.outfitSetKey(code);
      showIn("appearances", set, set);
    }
  }

  // World

  function renderWorld() {
    return el("div", renderReputation(), renderStoryFlags(), renderHostility());
  }

  function renderReputation() {
    const reps = Model.reputations(doc());
    return card("Faction reputation",
      reps.length ? el("div.grid", reps.map(r => globalField(r.label, r.k))) : el("p.muted", "No faction reputation in this save yet."),
      el("p.hint", "Only factions the save has a value for are listed."));
  }

  function renderStoryFlags() {
    const all = Model.listGlobals(doc());
    const filter = el("input", { type: "search", placeholder: `Search ${all.length} story flags, e.g. Lucia, CompanionStatus, Fame…`, value: flagFilter });
    const listWrap = el("div");
    const rows = flags => el("div.rows", flags.map(flag => {
      const { input, notes } = globalInput(flag.k, text(flag.node, "v"));
      input.setAttribute("aria-label", flag.k);
      const remove = () => { flag.node.remove(); done("Deleted " + flag.k); };
      return el("div.row", { dataset: { focus: "flag:" + flag.k } },
        el("span.grow.code-strong", flag.k), input, notes,
        el("button.icon", { type: "button", title: "Delete flag", onclick: remove }, "✕"));
    }));
    const draw = () => {
      const f = flagFilter.toLowerCase();
      const shown = f ? all.filter(g => g.k.toLowerCase().includes(f)) : all;
      flagPage = Math.min(flagPage, lastPage(shown.length, FLAGS_PER_PAGE));
      pagedList(listWrap, shown, flagPage, FLAGS_PER_PAGE, n => { flagPage = n; draw(); }, rows, "No matching flags.");
    };
    filter.oninput = () => { flagFilter = filter.value; flagPage = 0; draw(); };
    draw();

    const newKey = el("input", { type: "text", placeholder: "Flag name", spellcheck: false });
    const newValue = el("input", { type: "number", placeholder: "Value", value: "1", step: 1 });
    const addFlag = () => {
      const k = newKey.value.trim();
      const v = newValue.value.trim();
      if (!/^\w+$/.test(k)) return toast("Flag names are letters, numbers and underscores");
      if (!/^-?\d+$/.test(v) || +v < Model.INT_MIN || +v > Model.INT_MAX) return toast("Flag values are whole numbers");
      if (Model.getGlobal(doc(), k) !== undefined) return toast(k + " already exists; change it in the list");
      Model.setGlobal(doc(), k, String(+v));
      flagFilter = k;
      done();
    };

    return card("Story flags",
      caution("Changing story flags can break quests.", "They track quest steps, choices and who's alive. Change one at a time."),
      filter,
      listWrap,
      el("div.add-row", newKey, newValue, el("button.btn", { type: "button", onclick: addFlag }, "Add flag")));
  }

  function renderHostility() {
    const overrides = children(child(save(), "factions"), "hateOverride");
    return collapsible("hate", `Faction hostility overrides (${overrides.length})`,
      el("p.hint", "Pairs of factions forced to be hostile or friendly. The save only has their numbers."),
      el("div.rows", overrides.map(override => {
        const box = el("input", { type: "checkbox", checked: text(override, "hate") === "True" });
        box.onchange = () => { setText(override, "hate", box.checked ? "True" : "False"); changed(box); };
        const pair = `Faction ${text(override, "factionA")} and faction ${text(override, "factionB")}`;
        return el("label.row", el("span.grow", pair), box, el("span", "hostile"));
      })));
  }

  // Navigation

  function goto(target) {
    if (target.view) view = target.view;
    if (target.pc !== undefined) selectedPc = target.pc;
    if (target.flag !== undefined) { flagFilter = target.flag; flagPage = 0; }
    if (target.inventoryFilter !== undefined) { invFilter = target.inventoryFilter; invCategory = ""; invPage = 0; }
    if (target.open) openDetails.add(target.open);
    pendingFocus = target.focus || null;
    render();
  }

  function reset() {
    selectedPc = 0;
    view = "squad";
    invFilter = ""; invCategory = ""; invPage = 0;
    flagFilter = ""; flagPage = 0;
    openDetails.clear();
    for (const key in collectionState) delete collectionState[key];
  }

  return { render, goto, reset, addItem, showCollectible, selectedPcIndex: () => selectedPc };
})();

// Buttons offered next to codes in the Codes tab and search.
const CodeActions = (() => {
  function needSave() {
    if (App.save) return false;
    toast("Open a save first");
    return true;
  }

  function pickCharacter(anchor, title, apply) {
    if (needSave()) return;
    const pcs = Model.pcs(App.save.doc);
    popupMenu(anchor, [{ header: title }, ...pcs.map((pc, i) => ({ label: Model.pcName(pc, i), onClick: () => apply(pc) }))]);
  }

  // add(pc) returns true if it changed anything.
  function giveTo(label, title, add, message) {
    return smallButton(label, e => pickCharacter(e.currentTarget, title, pc => {
      if (!add(pc)) { toast(Model.pcName(pc) + " already has it"); return; }
      App.changed("codes");
      toast(message(pc), { undo: true });
    }));
  }

  function smallButton(label, onclick) {
    return el("button.btn.small", { type: "button", onclick }, label);
  }

  function forCode(category, code) {
    const name = displayName(code);
    const gave = pc => `Gave ${name} to ${Model.pcName(pc)}`;
    const showInCollectibles = smallButton("Show in Collectibles", () => { if (!needSave()) Main.goCollectible(code); });

    switch (category) {
      case "Items":
        if (!Model.isInventoryCode(code)) return showInCollectibles;
        return smallButton("Add to inventory", () => { if (!needSave()) SimpleEditor.addItem(code, 1); });
      case "Outfits":
        return showInCollectibles;
      case "Status Effects":
        return giveTo("Give to…", "Give " + name + " to", pc => Model.addStatusEffect(pc, code), gave);
      case "Abilities":
        return giveTo("Give to…", "Give " + name + " to", pc => Model.addAbility(pc, code), gave);
      case "Quirks Perks and Backgrounds": {
        const prefix = code.slice(0, 4);
        if (prefix === "PRK_") return giveTo("Give to…", "Give " + name + " to", pc => Model.addPerk(pc, code).added, gave);
        return giveTo("Set for…", "Set " + name + " for", pc => Model.setSinglePerk(pc, prefix, code), pc => `${name} → ${Model.pcName(pc)}`);
      }
      default:
        return null;
    }
  }

  return { forCode };
})();
