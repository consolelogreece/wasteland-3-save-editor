// App state and DOM helpers shared by every view.
"use strict";

const App = {
  save: null,        // { fields, doc, originalXmlBytes }
  file: null,        // original File
  dirty: false,
  listeners: [],     // called after any edit: fn(source)
  // key merges rapid edits to one field into one undo step.
  revision: 0,       // bumped on every edit
  changed(source, key) {
    if (source !== "history" && typeof History !== "undefined") History.commit(key);
    this.revision++;
    this.dirty = true;
    for (const fn of this.listeners) fn(source);
  },
  onChange(fn) { this.listeners.push(fn); },
  undo() { return History.undo(); },
  redo() { return History.redo(); },
};

function caution(lead, ...detail) {
  return el("div.caution", { role: "note" }, el("strong", lead), detail.length ? " " : null, ...detail);
}

function jumpLink(label, onclick) {
  return el("button.link-btn", { type: "button", onclick }, label);
}

function showSection(section, field) {
  if (!section) return;
  section.scrollIntoView({ block: "start", behavior: "smooth" });
  section.classList.remove("section-flash"); void section.offsetWidth; section.classList.add("section-flash");
  const input = field && field.querySelector("input, select, textarea");
  if (input) input.focus({ preventScroll: true });
}

// el("div.cls#id", {attrs/props/on*}, children...)
function el(spec, props, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec);
  const node = document.createElement(m[1] || "div");
  for (const part of (m[2] || "").match(/[.#][\w-]+/g) || []) {
    if (part[0] === ".") node.classList.add(part.slice(1));
    else node.id = part.slice(1);
  }
  if (props && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) {
    kids.unshift(props);
    props = null;
  }
  for (const k in props || {}) {
    const v = props[k];
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "class") { for (const c of String(v).split(/\s+/)) if (c) node.classList.add(c); }
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k in node && k !== "list") node[k] = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

// toast("Saved") or toast("Added 3 items", { undo: true }) for an Undo button.
function toast(msg, opts = {}) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.replaceChildren(el("span", msg));
  if (opts.undo && typeof History !== "undefined") {
    t.append(el("button.link", { type: "button", onclick: () => { App.undo(); t.hidden = true; } }, "Undo"));
  }
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), opts.undo ? 6000 : 2800);
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function banner(msg, kind = "error") {
  const b = document.getElementById("banner");
  if (!msg) { b.hidden = true; return; }
  b.className = kind;
  b.replaceChildren(el("span", msg), el("button.link", { type: "button", onclick: () => (b.hidden = true), title: "Dismiss" }, "✕"));
  b.hidden = false;
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// "PRK_SniperRifles_MasterfulPrecision" -> "Masterful Precision"
// "ITM_Equip_Weapon_SniperRifle_Tier6-1_SR2000Argent" -> "SR2000 Argent (T6)"
// "ITM_DLC1_Equip_Weapon_SniperRifle_DisruptionRay_Elite_Tier3" -> "Disruption Ray Elite (T3)"
const QUALIFIERS = /^(Elite|Unique|Legendary|Broken|Rusty|Pristine|Male|Female|Chest|Head|Legs|Feet|Hands|Helmet|Armor\w*|Mk\d+|V\d+|\d+)$/i;
function prettyCode(code) {
  if (!code) return "";
  let tier = "";
  const parts = code.split("_").filter(p => {
    const t = /^Tier(\d+)/i.exec(p);
    if (t) { tier = t[1]; return false; }
    return !/^(ITM|PRK|QRK|BCK|ABL|EFF)$/.test(p);
  });
  if (!parts.length) return code;
  const pick = [parts[parts.length - 1]];
  for (let i = parts.length - 2; i >= 0 && QUALIFIERS.test(pick[0]) && pick.length < 3; i--) pick.unshift(parts[i]);
  const words = pick.join(" ")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/(\d)([A-Za-z]{2,})/g, "$1 $2")
    .trim();
  return tier ? `${words} (T${tier})` : words;
}

// Wiki links and thumbnails, from the Fandom API. Only rows on screen are
// looked up, three at a time, and results are cached in localStorage.
function wikiQuery(name) { return String(name).replace(/\s*\(T\d+\)$/, ""); }
function wikiUrl(name) {
  const known = Wiki.cached(name);
  if (known && known.url) return known.url;
  return "https://wasteland.fandom.com/wiki/Special:Search?go=Go&search=" + encodeURIComponent(wikiQuery(name));
}
function wikiLink(name, label = "Wiki ↗") {
  return el("a.wiki", { href: wikiUrl(name), target: "_blank", rel: "noopener", title: `Open "${name}" on the Wasteland wiki`, dataset: { wiki: wikiQuery(name) } }, label);
}

const Wiki = (() => {
  const STORE = "wl3-wiki-thumbs-v2";
  const MAX_PARALLEL = 3;
  const mem = new Map();
  let saved = {};
  let downUntil = 0;          // pause lookups for a minute after repeated failures
  let failures = 0, active = 0, saveTimer = null;
  const queue = [];

  try { saved = JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch { saved = {}; }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch {} }, 1000);
  }

  // Exact title or redirect only. Search results are often a different item.
  const titleCase = s => s.replace(/\b([a-z])/g, c => c.toUpperCase());
  function request(q) {
    const titles = [...new Set([q, titleCase(q)])];
    const url = "https://wasteland.fandom.com/api.php?" + new URLSearchParams({
      action: "query", format: "json", origin: "*", titles: titles.join("|"), redirects: "1",
      prop: "pageimages|info", piprop: "thumbnail", pithumbsize: "240", inprop: "url",
    });
    return fetch(url).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(j => {
      const pages = j && j.query && j.query.pages ? Object.values(j.query.pages) : [];
      const page = pages.find(p => !("missing" in p) && !("invalid" in p));
      return page ? { title: page.title, url: page.fullurl, img: (page.thumbnail && page.thumbnail.source) || null } : null;
    });
  }

  function pump() {
    while (active < MAX_PARALLEL && queue.length) {
      const job = queue.shift();
      if (job.waiting.every(gone => gone())) { job.reject(new Error("cancelled")); continue; }
      if (Date.now() < downUntil) { job.reject(new Error("wiki unavailable")); continue; }
      active++;
      request(job.q).then(res => {
        failures = 0;
        saved[job.q] = res; persist();
        job.resolve(res);
      }, err => {
        if (++failures >= 3) { downUntil = Date.now() + 60000; failures = 0; }
        job.reject(err);
      }).finally(() => { active--; pump(); });
    }
  }

  // A queued lookup is skipped only once nobody waiting for it is on screen.
  function lookup(name, cancelled = () => false) {
    const q = wikiQuery(name);
    if (q in saved) return Promise.resolve(saved[q]);
    if (mem.has(q)) {
      const known = mem.get(q);
      known.job.waiting.push(cancelled);
      return known.promise;
    }
    const job = { q, waiting: [cancelled] };
    const promise = new Promise((resolve, reject) => { Object.assign(job, { resolve, reject }); queue.push(job); pump(); });
    mem.set(q, { job, promise });
    promise.catch(() => mem.delete(q));
    return promise;
  }

  function cached(name) { return saved[wikiQuery(name)] || null; }

  return { lookup, cached };
})();

const thumbObserver = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.target.isConnected) thumbObserver.unobserve(e.target);
    else if (e.isIntersecting) { thumbObserver.unobserve(e.target); e.target.load(); }
  }
}, { rootMargin: "200px" }) : null;

function wikiThumb(name) {
  const t = el("button.thumb", { type: "button", title: `Picture from the wiki: ${name}`, "aria-label": `Show picture of ${name}`, onclick: e => wikiPreview(name, e.currentTarget) });
  t.load = () => {
    t.classList.add("loading");
    Wiki.lookup(name, () => !t.isConnected).then(res => {
      t.classList.remove("loading");
      if (res && res.url) {
        for (const a of document.querySelectorAll("a.wiki")) if (a.dataset.wiki === wikiQuery(name)) a.href = res.url;
      }
      if (res && res.img) {
        const img = el("img", { src: res.img, alt: "", referrerPolicy: "no-referrer", decoding: "async" });
        img.onerror = () => { img.remove(); t.classList.add("none"); };
        t.append(img);
      } else t.classList.add("none");
    }, () => { t.classList.remove("loading"); t.classList.add("none"); });
  };
  if (thumbObserver) thumbObserver.observe(t); else setTimeout(t.load);
  return t;
}

let openPreview = null;
function closePreview() { if (openPreview) { openPreview.remove(); openPreview = null; } }
addEventListener("keydown", e => { if (e.key === "Escape") closePreview(); });
addEventListener("click", e => { if (openPreview && !openPreview.contains(e.target) && !e.target.closest("button.thumb")) closePreview(); });
addEventListener("scroll", closePreview, { passive: true });

function wikiPreview(name, anchor) {
  closePreview();
  const box = el("div.preview", { role: "dialog", "aria-label": "Wiki preview" }, el("div.muted", "Looking it up…"));
  document.body.append(box);
  openPreview = box;
  const r = anchor.getBoundingClientRect();
  box.style.left = Math.min(Math.max(8, r.left), innerWidth - 280) + "px";
  box.style.top = (r.bottom + 6 + 300 > innerHeight ? Math.max(8, r.top - 306) : r.bottom + 6) + "px";
  Wiki.lookup(name).then(res => {
    if (openPreview !== box) return;
    if (!res) { box.replaceChildren(el("div.muted", "The wiki has no page with exactly this name."), wikiLink(name)); return; }
    const kids = [];
    if (res.img) {
      const img = el("img", { src: res.img, alt: res.title, referrerPolicy: "no-referrer" });
      img.onerror = () => img.replaceWith(el("div.muted", "The wiki's picture didn't load."));
      kids.push(img);
    } else kids.push(el("div.muted", "That page has no picture."));
    kids.push(el("a", { href: res.url, target: "_blank", rel: "noopener" }, res.title + " ↗"));
    box.replaceChildren(...kids);
  }).catch(() => {
    if (openPreview !== box) return;
    box.replaceChildren(el("div.muted", "Couldn't reach the wiki."), wikiLink(name));
  });
}

const lastPage = (total, perPage) => Math.max(0, Math.ceil(total / perPage) - 1);
const pageItems = (list, page, perPage) => list.slice(page * perPage, (page + 1) * perPage);

// Prev / page x of y / next. onPage(n) is called with the new page index.
function pager(total, page, perPage, onPage) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  const go = n => onPage(Math.min(pages - 1, Math.max(0, n)));
  return el("div.pager",
    el("button.btn", { type: "button", disabled: page === 0, onclick: () => go(0), title: "First page" }, "«"),
    el("button.btn", { type: "button", disabled: page === 0, onclick: () => go(page - 1) }, "‹ Prev"),
    el("span.muted", `Page ${page + 1} of ${pages} · ${(page * perPage + 1).toLocaleString()}–${Math.min(total, (page + 1) * perPage).toLocaleString()} of ${total.toLocaleString()}`),
    el("button.btn", { type: "button", disabled: page >= pages - 1, onclick: () => go(page + 1) }, "Next ›"),
    el("button.btn", { type: "button", disabled: page >= pages - 1, onclick: () => go(pages - 1), title: "Last page" }, "»"));
}

function displayName(code) {
  if (!code) return "";
  const known = typeof GameNames !== "undefined" && GameNames[code];
  if (!known) return prettyCode(code);
  const tier = /_Tier(\d+)/i.exec(code);
  return tier ? `${known} (T${tier[1]})` : known;
}

// "ar_a1011_RangerHQ_Endgame" -> "Ranger HQ (Endgame)"
function locationName(code) {
  if (!code) return "";
  const parts = code.replace(/^ar_[a-z]?\d+_/i, "").split("_").filter(Boolean)
    .map(p => p.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"));
  if (!parts.length) return code;
  return parts[0] + (parts.length > 1 ? ` (${parts.slice(1).join(", ")})` : "");
}

function child(node, tag) {
  for (let c = node && node.firstElementChild; c; c = c.nextElementSibling) if (c.nodeName === tag) return c;
  return null;
}
function children(node, tag) {
  const out = [];
  for (let c = node && node.firstElementChild; c; c = c.nextElementSibling) if (!tag || c.nodeName === tag) out.push(c);
  return out;
}
function text(node, tag) {
  const c = tag ? child(node, tag) : node;
  return c ? c.textContent : "";
}
function setText(node, tag, value) {
  let c = child(node, tag);
  if (!c) { c = node.ownerDocument.createElement(tag); node.appendChild(c); }
  if (c.textContent !== String(value)) { c.textContent = String(value); return true; }
  return false;
}
function newEl(doc, tag, value) {
  const e = doc.createElement(tag);
  if (value !== undefined) e.textContent = String(value);
  return e;
}

async function copyText(s) {
  try { await navigator.clipboard.writeText(s); toast("Copied " + s); }
  catch { toast("Couldn't copy; select the text manually"); }
}
