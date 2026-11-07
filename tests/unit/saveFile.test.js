"use strict";

describe("LZF", () => {
  it("round-trips text", () => {
    const input = new TextEncoder().encode("<save>" + "<item>hello world</item>".repeat(2000) + "</save>");
    expect(new TextDecoder().decode(decompress(compress(input)))).toBe(new TextDecoder().decode(input));
  });

  it("round-trips short and repetitive input", () => {
    for (const s of ["a", "ab", "abc", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "xyz".repeat(5000)]) {
      const input = new TextEncoder().encode(s);
      expect(new TextDecoder().decode(decompress(compress(input)))).toBe(s);
    }
  });

  it("round-trips random bytes", () => {
    const input = crypto.getRandomValues(new Uint8Array(20000));
    const out = decompress(compress(input));
    expect(out.length).toBe(input.length);
    expect(out.every((v, i) => v === input[i])).toBeTruthy();
  });

  it("rejects corrupt input", () => {
    expect(() => decompress(new Uint8Array([0xff, 0xff, 0xff]))).toThrow();
  });
});

describe("SaveFile.read", () => {
  it("reads the header and XML", () => {
    const s = Fixtures.load();
    expect(SaveFile.getField(s.fields, "Location")).toBe("ar_a1001_RangerHQ");
    expect(s.doc.documentElement.nodeName).toBe("save");
    expect(text(s.doc.documentElement, "money")).toBe("5657");
  });

  it("rejects files that aren't saves", () => {
    expect(() => SaveFile.read(new TextEncoder().encode("hello").buffer)).toThrow(/doesn't look like a Wasteland 3 save/);
  });

  it("rejects a header without DataSize", () => {
    const bytes = new TextEncoder().encode("XLZF\nVersion:=1\n");
    expect(() => SaveFile.read(bytes.buffer)).toThrow(/DataSize/);
  });

  it("rejects corrupt compressed data", () => {
    const good = Fixtures.saveBytes();
    const bad = good.slice(0, good.length - 50);
    expect(() => SaveFile.read(bad.buffer)).toThrow();
  });

  it("rejects XML whose root isn't <save>", () => {
    expect(() => Fixtures.load("<other></other>")).toThrow(/root element/);
  });
});

describe("SaveFile.write", () => {
  it("writes back byte-identical XML when nothing changed", () => {
    const s = Fixtures.load();
    const w = SaveFile.write(s);
    expect(new TextDecoder().decode(w.xmlBytes)).toBe(Fixtures.XML);
    expect(w.xmlBytes.length).toBe(s.originalXmlBytes.length);
  });

  it("keeps whitespace and the order of mixed siblings", () => {
    const s = Fixtures.load();
    const xml = new TextDecoder().decode(SaveFile.write(s).xmlBytes);
    expect(xml).toContain("<mod>8</mod><perceived>True</perceived><mod>8</mod><perceived>True</perceived>\n\t\t\t<mod>3</mod>");
  });

  it("sets DataSize to the XML's byte length, not its character count", () => {
    const s = Fixtures.load();
    const w = SaveFile.write(s);
    const out = SaveFile.read(w.bytes.buffer);
    expect(+SaveFile.getField(out.fields, "DataSize")).toBe(w.xmlBytes.byteLength);
    expect(w.xmlBytes.byteLength).toBeGreaterThan(new TextDecoder().decode(w.xmlBytes).length - 1);
  });

  it("sets SaveDataSize to the compressed length", () => {
    const w = SaveFile.write(Fixtures.load());
    const header = new TextDecoder("latin1").decode(w.bytes.subarray(0, 400));
    const size = +/SaveDataSize:=(\d+)/.exec(header)[1];
    // The fixture header ends with Permadeath, so the data starts right after it.
    const headerLength = header.indexOf("Permadeath:=False\n") + "Permadeath:=False\n".length;
    expect(w.bytes.length - size).toBe(headerLength);
  });

  it("keeps non-ASCII header values byte for byte", () => {
    const w = SaveFile.write(Fixtures.load());
    const original = Fixtures.saveBytes();
    const find = (b, s) => { const t = new TextEncoder().encode(s); outer: for (let i = 0; i < b.length; i++) { for (let j = 0; j < t.length; j++) if (b[i + j] !== t[j]) continue outer; return i; } return -1; };
    expect(find(w.bytes, "Names:=Zoë\n")).toBeGreaterThan(0);
    expect(find(original, "Names:=Zoë\n")).toBeGreaterThan(0);
  });

  it("escapes &, < and > in values it writes", () => {
    const s = Fixtures.load();
    setText(s.doc.documentElement, "currentScene", "a & b <c> d");
    const xml = new TextDecoder().decode(SaveFile.write(s).xmlBytes);
    expect(xml).toContain("<currentScene>a &amp; b &lt;c&gt; d</currentScene>");
    expect(SaveFile.read(SaveFile.write(s).bytes.buffer).doc.documentElement.querySelector("currentScene").textContent).toBe("a & b <c> d");
  });

  it("escapes attribute values", () => {
    const d = Fixtures.doc('<save><n a="R&amp;D &quot;x&quot;">1</n></save>');
    expect(SaveFile.serialize(d, false)).toBe('<save><n a="R&amp;D &quot;x&quot;">1</n></save>');
  });

  it("writes empty elements as open/close pairs like the game", () => {
    expect(SaveFile.serialize(Fixtures.doc("<save><a></a><b/></save>"), false)).toBe("<save><a></a><b></b></save>");
  });

  it("survives several edit, write and read cycles", () => {
    let s = Fixtures.load();
    for (let i = 0; i < 5; i++) {
      setText(s.doc.documentElement, "money", 1000 + i);
      s = SaveFile.read(SaveFile.write(s).bytes.buffer);
      expect(text(s.doc.documentElement, "money")).toBe(String(1000 + i));
    }
    expect(text(s.doc.documentElement, "currentScene")).toBe("ar_a1001_RangerHQ");
  });
});

describe("SaveFile.serialize (pretty)", () => {
  it("indents and drops whitespace-only text", () => {
    const out = SaveFile.serialize(Fixtures.doc("<save>\n <a>1</a>\n <b><c>2</c></b></save>"), true);
    expect(out).toBe("<save>\n  <a>1</a>\n  <b>\n    <c>2</c>\n  </b>\n</save>");
  });

  it("records each element's line", () => {
    const d = Fixtures.doc("<save><a>1</a><b><c>2</c></b></save>");
    const lines = new Map();
    const out = SaveFile.serialize(d, true, lines).split("\n");
    for (const [node, line] of lines) expect(out[line]).toContain("<" + node.nodeName + ">");
    expect(lines.size).toBe(4);
  });

  it("records each element's last line when asked", () => {
    const d = Fixtures.doc("<save><a>1</a><b><c>2</c></b></save>");
    const lines = new Map();
    lines.ends = new Map();
    const out = SaveFile.serialize(d, true, lines).split("\n");
    for (const [node, line] of lines.ends) expect(out[line]).toContain("</" + node.nodeName + ">");
    expect(lines.ends.get(d.documentElement)).toBe(out.length - 1);
  });

  it("parses back to the same values after stripping whitespace", () => {
    const pretty = SaveFile.serialize(Fixtures.doc(), true);
    const back = new DOMParser().parseFromString(pretty, "application/xml");
    SaveFile.stripWhitespace(back.documentElement);
    expect(SaveFile.serialize(back, false)).toBe(SaveFile.serialize(Fixtures.doc(Fixtures.XML.replace("\n\t\t\t", "")), false));
  });
});

describe("Refusing damaged data", () => {
  it("won't write a character XML can't hold", () => {
    const s = Fixtures.load();
    setText(s.doc.documentElement, "currentScene", "bad\u0001value");
    expect(() => SaveFile.write(s)).toThrow(/isn't allowed/);
  });

  it("won't open a save whose size doesn't match its header", () => {
    const bytes = Fixtures.saveBytes();
    const textHead = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
    const size = /DataSize:=(\d+)/.exec(textHead)[1];
    const wrong = textHead.replace("DataSize:=" + size, "DataSize:=" + (+size + 1).toString().padStart(size.length, "0").slice(-size.length));
    const out = new Uint8Array(bytes);
    out.set(new Uint8Array([...wrong].map(c => c.charCodeAt(0))), 0);
    expect(() => SaveFile.read(out.buffer)).toThrow(/doesn't match its header/);
  });
});

describe("Undo limits", () => {
  it("keeps only the last 20 whole-document swaps", () => {
    App.save = { doc: Fixtures.doc(), fields: [], originalXmlBytes: new TextEncoder().encode(Fixtures.XML) };
    History.attach(App.save.doc);
    for (let i = 0; i < 30; i++) {
      const next = Fixtures.doc();
      History.swapped(App.save.doc, next);
      App.save.doc = next;
    }
    let n = 0;
    while (History.undo()) n++;
    expect(n).toBe(20);
  });
});
