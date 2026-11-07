// Minimal test runner for the browser. No dependencies.
"use strict";

const Harness = (() => {
  const suites = [];
  let current = null;

  function describe(name, fn) {
    const suite = { name, tests: [], before: [] };
    const prev = current;
    current = suite;
    suites.push(suite);
    fn();
    current = prev;
  }
  function it(name, fn) { current.tests.push({ name, fn }); }
  function beforeEach(fn) { current.before.push(fn); }

  class AssertionError extends Error {}
  const show = v => {
    try { return typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v, null, 0); } catch { return String(v); }
  };
  function deepEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  function expect(actual) {
    const fail = msg => { throw new AssertionError(msg); };
    return {
      toBe: v => { if (!Object.is(actual, v)) fail(`expected ${show(actual)} to be ${show(v)}`); },
      toEqual: v => { if (!deepEqual(actual, v)) fail(`expected ${show(actual)} to equal ${show(v)}`); },
      toBeTruthy: () => { if (!actual) fail(`expected ${show(actual)} to be truthy`); },
      toBeFalsy: () => { if (actual) fail(`expected ${show(actual)} to be falsy`); },
      toContain: v => { if (!actual || !actual.includes(v)) fail(`expected ${show(actual)} to contain ${show(v)}`); },
      toMatch: re => { if (!re.test(actual)) fail(`expected ${show(actual)} to match ${re}`); },
      toBeGreaterThan: v => { if (!(actual > v)) fail(`expected ${show(actual)} to be greater than ${v}`); },
      toThrow: re => {
        let threw = null;
        try { actual(); } catch (e) { threw = e; }
        if (!threw) fail("expected function to throw");
        if (re && !re.test(threw.message)) fail(`expected error matching ${re}, got ${show(threw.message)}`);
      },
    };
  }

  async function run() {
    const results = [];
    for (const s of suites) {
      for (const t of s.tests) {
        const started = performance.now();
        try {
          for (const b of s.before) await b();
          await t.fn();
          results.push({ suite: s.name, name: t.name, ok: true, ms: performance.now() - started });
        } catch (e) {
          results.push({ suite: s.name, name: t.name, ok: false, error: e.message, stack: e instanceof AssertionError ? "" : e.stack });
        }
      }
    }
    return results;
  }

  function report(results, container) {
    const failed = results.filter(r => !r.ok);
    container.replaceChildren();
    const h = document.createElement("h1");
    h.textContent = failed.length ? `${failed.length} of ${results.length} tests failed` : `All ${results.length} tests passed`;
    h.className = failed.length ? "fail" : "pass";
    container.append(h);
    let suite = null, ul = null;
    for (const r of results) {
      if (r.suite !== suite) {
        suite = r.suite;
        const h2 = document.createElement("h2");
        h2.textContent = suite;
        ul = document.createElement("ul");
        container.append(h2, ul);
      }
      const li = document.createElement("li");
      li.className = r.ok ? "pass" : "fail";
      li.textContent = (r.ok ? "✓ " : "✗ ") + r.name + (r.ok ? "" : ": " + r.error);
      if (r.stack) { const pre = document.createElement("pre"); pre.textContent = r.stack; li.append(pre); }
      ul.append(li);
    }
  }

  return { describe, it, beforeEach, expect, run, report };
})();

const { describe, it, beforeEach, expect } = Harness;
