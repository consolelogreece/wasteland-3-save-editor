// Every known code, searchable, with buttons to use them on the open save.
"use strict";

const CodesView = (() => {
  const PER_PAGE = 50;
  let root, category = "All", query = "", page = 0;

  const entries = {};
  for (const [group, codes] of Object.entries(metaData)) {
    const list = Array.isArray(codes)
      ? codes.map(code => ({ code, name: displayName(code) }))
      : Object.entries(codes).map(([name, code]) => ({ code, name }));
    entries[group] = list.map(e => ({ ...e, category: group, hay: (e.name + " " + e.code).toLowerCase() }));
  }
  const allEntries = Object.values(entries).flat();

  function render(container) {
    root = container || root;
    if (root.childElementCount) return;
    const search = el("input", { type: "search", placeholder: "Search by name or code, e.g. medic pack, sniper, lone wolf", value: query });
    const cats = el("div.chips.cats");
    const list = el("div.rows.codes");
    const info = el("div.muted");
    const pagerTop = el("div"), pagerBottom = el("div");

    const draw = () => {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const match = e => !words.length || words.every(w => e.hay.includes(w));
      const counts = {};
      for (const [c, es] of Object.entries(entries)) counts[c] = es.filter(match).length;
      counts.All = Object.values(counts).reduce((a, n) => a + n, 0);
      const categoryChip = c => el("button", {
        type: "button", class: "chip" + (c === category ? " active" : ""),
        onclick: () => { category = c; page = 0; draw(); },
      }, c, el("span.count", " " + counts[c]));
      cats.replaceChildren(...["All", ...Object.keys(entries)].map(categoryChip));
      const pool = category === "All" ? allEntries : entries[category];
      const hits = words.length ? pool.filter(match) : pool;
      page = Math.min(page, lastPage(hits.length, PER_PAGE));
      info.textContent = `${hits.length.toLocaleString()} code${hits.length === 1 ? "" : "s"}. Click a name to copy its code.`;
      const nav = () => pager(hits.length, page, PER_PAGE, n => { page = n; draw(); listCard.scrollIntoView({ block: "start" }); }) || "";
      pagerTop.replaceChildren(nav());
      pagerBottom.replaceChildren(nav());
      list.replaceChildren(...pageItems(hits, page, PER_PAGE).map(e => el("div.row.code-row",
        wikiThumb(e.name),
        el("button.copy", { type: "button", onclick: () => copyText(e.code), title: "Copy " + e.code },
          el("span.grow", el("strong", e.name), category === "All" ? el("span.muted", " · " + e.category) : null),
          el("code", e.code)),
        CodeActions.forCode(e.category, e.code),
        wikiLink(e.name))));
    };
    search.oninput = () => { query = search.value.trim(); page = 0; draw(); };
    const listCard = el("div.card", pagerTop, list, pagerBottom);
    root.replaceChildren(
      el("div.card", search, cats, el("p.hint", "Skills show the number the save uses for each skill."), info),
      listCard);
    draw();
  }

  return { render };
})();
