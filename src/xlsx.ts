import { unzip } from "./zip.js";

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unesc = (s: string) => s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m)));

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Read every sheet of an .xlsx file as rows of strings (shared strings, inline strings and numbers). */
export function readXlsx(buf: Buffer): Map<string, string[][]> {
  const files = unzip(buf);
  // drop namespace prefixes on element names (<x:row> -> <row>)
  const txt = (name: string) => (files.get(name)?.toString("utf8") ?? "").replace(/<(\/?)[A-Za-z][\w.-]*:/g, "<$1");
  const shared: string[] = [];
  for (const si of txt("xl/sharedStrings.xml").match(/<si>[\s\S]*?<\/si>/g) ?? [])
    shared.push(unesc([...si.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
  const rels = new Map<string, string>();
  for (const m of txt("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/Id="([^"]+)"/)?.[1];
    const target = m[0].match(/Target="([^"]+)"/)?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  const out = new Map<string, string[][]>();
  for (const m of txt("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc(m[0].match(/name="([^"]+)"/)?.[1] ?? "");
    const rid = m[0].match(/r:id="([^"]+)"/)?.[1] ?? "";
    const xml = txt(`xl/${rels.get(rid) ?? ""}`);
    const rows: string[][] = [];
    for (const row of xml.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
      const cells: string[] = [];
      for (const c of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
        const t = attrs.match(/t="(\w+)"/)?.[1];
        const body = c[2] ?? "";
        let v = "";
        if (t === "s") v = shared[+(body.match(/<v>([^<]*)<\/v>/)?.[1] ?? -1)] ?? "";
        else if (t === "inlineStr") v = unesc([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
        else v = unesc(body.match(/<v>([^<]*)<\/v>/)?.[1] ?? "");
        const i = ref ? colIndex(ref) : cells.length;
        while (cells.length < i) cells.push("");
        cells[i] = v;
      }
      rows.push(cells);
    }
    out.set(name, rows);
  }
  return out;
}
