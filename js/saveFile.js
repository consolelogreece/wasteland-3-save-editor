// Reading and writing Wasteland 3 save files.
//
// A save is a short plain-text header ("Key:=Value" lines) followed by
// LZF-compressed XML. Everything here works on raw bytes so nothing in the
// header or the XML gets re-encoded by accident.
"use strict";

const SaveFile = (() => {
  const MAGIC = "XLZF\n";

  // Bytes <-> "binary string" (one char per byte, no re-encoding).
  function bytesToBinary(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return s;
  }
  function binaryToBytes(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  function parseHeaderLines(headerText) {
    const fields = [];
    for (const line of headerText.split("\n")) {
      if (!line) continue;
      const i = line.indexOf(":=");
      fields.push(i < 0 ? { key: line, value: null } : { key: line.slice(0, i), value: line.slice(i + 2) });
    }
    return fields;
  }

  function getField(fields, key) {
    const field = fields.find(f => f.key === key);
    return field ? field.value : undefined;
  }

  function read(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const start = bytesToBinary(bytes.subarray(0, 5));
    if (start !== MAGIC) {
      throw new Error("This doesn't look like a Wasteland 3 save (it should start with XLZF). Pick one of the .xml files in your Save Games folder.");
    }

    // The compressed data is the last SaveDataSize bytes of the file.
    const probe = bytesToBinary(bytes.subarray(0, Math.min(bytes.length, 4096)));
    const sizeMatch = /\nSaveDataSize:=(\d+)\n/.exec(probe);
    let headerLength;
    if (sizeMatch && +sizeMatch[1] <= bytes.length) {
      headerLength = bytes.length - +sizeMatch[1];
    } else {
      const m = /^((?:(?:XLZF|[A-Za-z]+:=[^\n]*)\n)+)/.exec(probe);
      if (!m) throw new Error("Couldn't read the save header.");
      headerLength = m[1].length;
    }

    const headerText = bytesToBinary(bytes.subarray(0, headerLength));
    const fields = parseHeaderLines(headerText);
    if (getField(fields, "DataSize") === undefined) {
      throw new Error("The save header is missing DataSize, so this file can't be edited safely.");
    }

    let xmlBytes;
    try {
      xmlBytes = decompress(bytes.subarray(headerLength));
    } catch {
      throw new Error("Couldn't decompress the save. The file may be damaged or from an unsupported version.");
    }

    if (xmlBytes.length !== +getField(fields, "DataSize")) {
      throw new Error("The save's size doesn't match its header, so it may be damaged and wasn't opened.");
    }
    let xmlText;
    try { xmlText = new TextDecoder("utf-8", { fatal: true }).decode(xmlBytes); }
    catch { throw new Error("The save contains text that isn't valid UTF-8, so it may be damaged and wasn't opened."); }
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    const err = doc.querySelector("parsererror");
    if (err) throw new Error("The save's XML is invalid: " + err.textContent.slice(0, 200));
    if (doc.documentElement.nodeName !== "save") {
      throw new Error("Unexpected save contents (root element is <" + doc.documentElement.nodeName + ">).");
    }

    return { fields, doc, originalXmlBytes: xmlBytes };
  }

  // Characters XML can't hold at all. Writing one would make the save unreadable.
  const INVALID_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;
  function checkChars(s) {
    if (INVALID_CHAR.test(s)) throw new Error("A value contains a character that isn't allowed in a save.");
    return s;
  }
  function findInvalidChar(node) {
    for (const n of [node, ...node.getElementsByTagName("*")]) {
      for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && INVALID_CHAR.test(c.nodeValue)) return n;
      for (const a of n.attributes) if (INVALID_CHAR.test(a.value)) return n;
    }
    return null;
  }

  // Escaping matching what .NET's XmlWriter produces.
  function escText(s) {
    checkChars(s);
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escAttr(s) {
    return escText(s).replace(/"/g, "&quot;");
  }

  // Serialise a DOM node. With pretty=false the output keeps the document's own
  // whitespace exactly (so an unedited save round-trips byte for byte). With
  // pretty=true whitespace-only text is dropped and the tree is indented, and
  // if a Map is passed as lines, each element's 0-based line number is stored
  // (and its last line in lines.ends, if that is a Map too).
  function serialize(node, pretty, lines) {
    const parts = [];
    let line = 0;
    const countLines = str => { for (let i = str.indexOf("\n"); i >= 0; i = str.indexOf("\n", i + 1)) line++; };
    const walk = (n, depth) => {
      if (n.nodeType === 3) {
        if (pretty && !/\S/.test(n.nodeValue)) return;
        if (lines) countLines(n.nodeValue);
        parts.push(escText(n.nodeValue));
      } else if (n.nodeType === 4) {
        parts.push("<![CDATA[" + n.nodeValue + "]]>");
      } else if (n.nodeType === 8) {
        parts.push("<!--" + n.nodeValue + "-->");
      } else if (n.nodeType === 1) {
        const ind = pretty ? "\n" + "  ".repeat(depth) : "";
        if (pretty && depth) line++;
        if (lines) lines.set(n, line);
        parts.push((depth || !pretty ? ind : "") + "<" + n.nodeName);
        for (const a of n.attributes) parts.push(" " + a.name + '="' + escAttr(a.value) + '"');
        parts.push(">");
        const elementKids = pretty && hasElementChildren(n);
        for (let c = n.firstChild; c; c = c.nextSibling) walk(c, depth + 1);
        if (elementKids) { parts.push(ind); line++; }
        parts.push("</" + n.nodeName + ">");
        if (lines && lines.ends) lines.ends.set(n, line);
      }
    };
    walk(node.nodeType === 9 ? node.documentElement : node, 0);
    return parts.join("");
  }

  function hasElementChildren(n) {
    for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) return true;
    return false;
  }

  // Drops whitespace-only text from element-only content (raw editor input).
  function stripWhitespace(node) {
    let c = node.firstChild;
    const hasEl = hasElementChildren(node);
    while (c) {
      const next = c.nextSibling;
      if (c.nodeType === 3 && hasEl && !/\S/.test(c.nodeValue)) node.removeChild(c);
      else if (c.nodeType === 1) stripWhitespace(c);
      c = next;
    }
    return node;
  }

  function write(save) {
    const xmlBytes = new TextEncoder().encode(serialize(save.doc, false));
    const compressed = compress(xmlBytes);

    const lines = save.fields.map(f => {
      let v = f.value;
      if (f.key === "DataSize") v = String(xmlBytes.byteLength);
      else if (f.key === "SaveDataSize") v = String(compressed.byteLength);
      return v === null ? f.key : f.key + ":=" + v;
    });
    const header = binaryToBytes(lines.join("\n") + "\n");

    const out = new Uint8Array(header.length + compressed.length);
    out.set(header, 0);
    out.set(compressed, header.length);
    return { bytes: out, xmlBytes };
  }

  return { read, write, serialize, stripWhitespace, getField, findInvalidChar, INVALID_CHAR };
})();
