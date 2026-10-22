import { test } from "node:test";
import assert from "node:assert/strict";
import { fold, stem, parseQuery, labelParts, packCount } from "../dist/drugs.js";
import { parseCsv, parsePacks, parseRefund } from "../dist/data.js";
import { readXlsx } from "../dist/xlsx.js";

test("Polish and Latin substance names fold together", () => {
  const same = (a, b) => assert.equal(stem(fold(a)), stem(fold(b)), `${a} vs ${b}`);
  same("atorwastatyna", "Atorvastatinum");
  same("amoksycylina", "Amoxicillinum");
  same("lewotyroksyna", "Levothyroxinum");
  same("metformina", "Metformini");
});

test("query parsing: strength, pack size, EAN, bare numbers", () => {
  assert.deepEqual(parseQuery("Tulip 20 mg 30 szt"), { words: ["tulip"], numbers: undefined, strength: "20 mg", count: 30 });
  assert.equal(parseQuery("Euthyrox N 50").numbers?.[0], "50");
  assert.equal(parseQuery("05909990998913").gtin, "5909990998913");
  assert.equal(parseQuery("Letrox 100 mcg").strength, "100 µg");
});

test("refund labels and pack sizes", () => {
  assert.deepEqual(labelParts("Tulip, tabl. powl., 20 mg"), { brand: "Tulip", form: "tabl. powl.", strength: "20 mg" });
  assert.equal(packCount("28 szt. (2 x 14)"), 28);
  assert.equal(packCount("1 fiol. 5 ml"), 1);
});

test("RPL CSV: quoted multi-line fields and packs", () => {
  const rows = parseCsv('"a";"b"\n"1";"x ¦ y\nline"\n');
  assert.deepEqual(rows, [["a", "b"], ["1", "x ¦ y\nline"]]);
  const packs = parsePacks("05909990998913 ¦ Rp ¦ 20730\n30 tabl.\n100 tabl. Rp ¦ EU/1/08/472/024 ¦ 1\n05909990998937 ¦ Rp ¦ 23695\n90 tabl.");
  assert.deepEqual(packs.map((p) => [p.gtin, p.cat, p.content]), [["05909990998913", "Rp", "30 tabl."], ["05909990998937", "Rp", "90 tabl."]]);
});

// tiny stored-zip writer to build an .xlsx in memory
function zip(files) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals = [], centrals = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), nm = Buffer.from(name), c = crc(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(c, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(c, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, data); centrals.push(ch, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

test("xlsx (namespaced) -> refund rows and free-drug lists", () => {
  const hdr = ["LP", "Substancja czynna", "Nazwa  postać i dawka", "Zawartość opakowania", "Numer GTIN lub inny kod", "Termin wejścia w życie decyzji", "Okres", "Grupa limitowa", "Cena zbytu netto", "Urzędowa cena zbytu", "Cena hurtowa brutto", "Cena detaliczna", "Wysokość limitu finansowania", "Zakres wskazań objętych refundacją", "Zakres wskazań pozarejestracyjnych", "Poziom odpłatności", "Wysokość dopłaty świadczeniobiorcy"];
  const strings = [...hdr, "Atorvastatinum", "Tulip, tabl. powl., 20 mg", "30 szt.", "05909990998913", "46.0, Leki", "We wszystkich zarejestrowanych wskazaniach", "30%"];
  const s = (t) => `<x:c t="s"><x:v>${strings.indexOf(t)}</x:v></x:c>`;
  const n = (v) => `<x:c><x:v>${v}</x:v></x:c>`;
  const sheetA1 = `<x:worksheet xmlns:x="m"><x:sheetData><x:row>${s("LP")}</x:row><x:row>${hdr.map(s).join("")}</x:row><x:row>${n(1)}${s("Atorvastatinum")}${s("Tulip, tabl. powl., 20 mg")}${s("30 szt.")}${s("05909990998913")}${n(1)}${n(1)}${s("46.0, Leki")}${n(1)}${n(1)}${n(1)}${n("15.52")}${n("8.46")}${s("We wszystkich zarejestrowanych wskazaniach")}<x:c/>${s("30%")}${n("8.64")}</x:row></x:sheetData></x:worksheet>`;
  const sheetD1 = `<x:worksheet xmlns:x="m"><x:sheetData><x:row>${s("LP")}${s("Numer GTIN lub inny kod")}</x:row><x:row>${n(1)}${s("05909990998913")}</x:row></x:sheetData></x:worksheet>`;
  const buf = zip({
    "xl/workbook.xml": `<x:workbook xmlns:x="m" xmlns:r="r"><x:sheets><x:sheet name="A1" sheetId="1" r:id="rId1"/><x:sheet name="D1" sheetId="2" r:id="rId2"/></x:sheets></x:workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<x:sst xmlns:x="m">${strings.map((t) => `<x:si><x:t>${t}</x:t></x:si>`).join("")}</x:sst>`,
    "xl/worksheets/sheet1.xml": sheetA1,
    "xl/worksheets/sheet2.xml": sheetD1,
  });
  const { refund, free } = parseRefund(readXlsx(buf));
  assert.equal(refund.length, 1);
  assert.equal(refund[0].copay, 8.64);
  assert.equal(refund[0].retail, 15.52);
  assert.equal(refund[0].gtin, "5909990998913");
  assert.ok(free.senior.has("5909990998913"));
});
