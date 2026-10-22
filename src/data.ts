import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config, log } from "./config.js";
import { readXlsx } from "./xlsx.js";

export interface Pack {
  gtin: string;
  /** OTC, Rp, Rpz, Rpw, Lz */
  cat: string;
  content: string;
}

export interface Product {
  id: string;
  name: string;
  inn: string;
  strength: string;
  form: string;
  atc: string;
  holder: string;
  substance: string;
  validity: string;
  leaflet: string;
  spc: string;
  packs: Pack[];
}

export interface RefundRow {
  list: "A1" | "A2" | "A3";
  substance: string;
  /** "Tulip, tabl. powl., 20 mg" */
  label: string;
  content: string;
  gtin: string;
  since: string;
  limitGroup: string;
  retail: number;
  limit: number;
  indication: string;
  offLabel: string;
  level: string;
  copay: number;
}

export interface Dataset {
  products: Product[];
  byGtin: Map<string, { product: Product; pack: Pack }>;
  refund: RefundRow[];
  /** free for 65+ (D1), under 18 (D2), pregnant (E) */
  free: { senior: Set<string>; child: Set<string>; pregnant: Set<string> };
  refundTitle: string;
  refundUrl: string;
  loadedAt: string;
}

const num = (s: string | undefined) => {
  const v = Number(String(s ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};
export const normGtin = (g: string) => g.replace(/\D/g, "").replace(/^0+/, "");

async function fetchBuf(url: string, ms = 120_000): Promise<Buffer> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "user-agent": `Mozilla/5.0 (compatible; ${config.userAgent})` } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------------ RPL (CSV)

/** RFC4180-ish CSV with ";" separator and quoted multi-line fields. */
export function parseCsv(text: string, sep = ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(f);
      f = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f);
      rows.push(row);
      row = [];
      f = "";
    } else f += c;
  }
  if (f || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows;
}

export function parsePacks(s: string): Pack[] {
  const lines = s.split(/\r?\n/).map((l) => l.trim());
  const out: Pack[] = [];
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split("¦").map((x) => x.trim());
    if (parts.length >= 2 && /^\d{8,14}$/.test(parts[0])) {
      const content: string[] = [];
      while (i + 1 < lines.length && !lines[i + 1].includes("¦")) content.push(lines[++i]);
      out.push({ gtin: parts[0], cat: parts[1], content: content.join(" ").trim() });
    }
  }
  return out;
}

export function parseRpl(text: string): Product[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const h = rows[0] ?? [];
  const col = (name: string) => h.findIndex((x) => x.trim().toLowerCase() === name.toLowerCase());
  const c = {
    id: col("Identyfikator Produktu Leczniczego"),
    name: col("Nazwa Produktu Leczniczego"),
    inn: col("Nazwa powszechnie stosowana"),
    kind: col("Rodzaj preparatu"),
    strength: col("Moc"),
    form: col("Postać farmaceutyczna"),
    validity: col("Ważność pozwolenia"),
    atc: col("Kod ATC"),
    holder: col("Podmiot odpowiedzialny"),
    packs: col("Opakowanie"),
    substance: col("Substancja czynna"),
    leaflet: col("Ulotka"),
    spc: col("Charakterystyka"),
  };
  if (c.name < 0 || c.packs < 0) throw new Error("unexpected RPL CSV header");
  const out: Product[] = [];
  for (const r of rows.slice(1)) {
    if (r.length < 10) continue;
    if (c.kind >= 0 && r[c.kind] && r[c.kind] !== "Ludzki") continue;
    out.push({
      id: r[c.id] ?? "",
      name: r[c.name] ?? "",
      inn: r[c.inn] ?? "",
      strength: r[c.strength] ?? "",
      form: r[c.form] ?? "",
      atc: r[c.atc] ?? "",
      holder: r[c.holder] ?? "",
      substance: (r[c.substance] ?? "").replace(/\s+/g, " "),
      validity: r[c.validity] ?? "",
      leaflet: r[c.leaflet] ?? "",
      spc: r[c.spc] ?? "",
      packs: parsePacks(r[c.packs] ?? ""),
    });
  }
  return out;
}

// ------------------------------------------------------------------ refund list (MZ, xlsx)

export function parseRefund(sheets: Map<string, string[][]>): { refund: RefundRow[]; free: Dataset["free"] } {
  const refund: RefundRow[] = [];
  for (const list of ["A1", "A2", "A3"] as const) {
    const rows = sheets.get(list) ?? [];
    const hi = rows.findIndex((r) => r.some((x) => /^LP$/i.test(x.trim())) && r.some((x) => /gtin/i.test(x)));
    if (hi < 0) continue;
    const h = rows[hi].map((x) => x.toLowerCase().replace(/\s+/g, " "));
    const f = (re: RegExp) => h.findIndex((x) => re.test(x));
    const c = {
      substance: f(/substancja czynna/),
      label: f(/nazwa/),
      content: f(/zawarto/),
      gtin: f(/gtin/),
      since: f(/wejścia w życie/),
      group: f(/grupa limitowa/),
      retail: f(/cena detaliczna/),
      limit: f(/limitu finansowania/),
      ind: f(/zakres wskazań objętych/),
      off: f(/pozarejestracyjnych/),
      level: f(/poziom odpłatności/),
      copay: f(/dopłaty/),
    };
    for (const r of rows.slice(hi + 1)) {
      const gtin = r[c.gtin]?.trim();
      if (!gtin || !/\d{8}/.test(gtin)) continue;
      refund.push({
        list,
        substance: r[c.substance]?.trim() ?? "",
        label: r[c.label]?.replace(/\s+/g, " ").trim() ?? "",
        content: r[c.content]?.trim() ?? "",
        gtin: normGtin(gtin),
        since: r[c.since]?.trim() ?? "",
        limitGroup: r[c.group]?.trim() ?? "",
        retail: num(r[c.retail]),
        limit: num(r[c.limit]),
        indication: r[c.ind]?.replace(/\s+/g, " ").trim() ?? "",
        offLabel: r[c.off]?.replace(/\s+/g, " ").trim() ?? "",
        level: r[c.level]?.trim() ?? "",
        copay: num(r[c.copay]),
      });
    }
  }
  const gtins = (name: string) => {
    const rows = sheets.get(name) ?? [];
    const hi = rows.findIndex((r) => r.some((x) => /^LP$/i.test(x.trim())) && r.some((x) => /gtin/i.test(x)));
    const gi = hi >= 0 ? rows[hi].findIndex((x) => /gtin/i.test(x)) : -1;
    return new Set(gi < 0 ? [] : rows.slice(hi + 1).map((r) => normGtin(r[gi] ?? "")).filter(Boolean));
  };
  return { refund, free: { senior: gtins("D1"), child: gtins("D2"), pregnant: gtins("E") } };
}

/** Newest "obwieszczenie ... wykazu refundowanych leków" page on gov.pl and its .xlsx annex. */
export async function discoverRefund(): Promise<{ url: string; title: string }> {
  if (config.refundXlsxUrl) return { url: config.refundXlsxUrl, title: "wykaz leków refundowanych (LEKI_REFUND_XLSX_URL)" };
  const index = (await fetchBuf(config.refundIndexUrl, 30_000)).toString("utf8");
  const pages = [...index.matchAll(/href="(\/web\/zdrowie\/obwieszczenie-ministra-zdrowia-z-dnia-[^"]*wykazu-refundowanych[^"]*)"/g)].map((m) => m[1]);
  if (!pages.length) throw new Error("no refund list announcement found on gov.pl");
  for (const page of pages.slice(0, 3)) {
    const html = (await fetchBuf(new URL(page, config.refundIndexUrl).toString(), 30_000)).toString("utf8");
    for (const m of html.matchAll(/<a[^>]*href="(\/attachment\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const text = m[2].replace(/<[^>]+>/g, " ").replace(/[​\s_]+/g, " ").toLowerCase();
      if (/zalacznik do obwieszczenia/.test(text) && /xlsx/.test(text)) {
        const slug = page.split("/").pop()!;
        const MONTHS: Record<string, string> = { stycznia: "stycznia", lutego: "lutego", marca: "marca", kwietnia: "kwietnia", maja: "maja", czerwca: "czerwca", lipca: "lipca", sierpnia: "sierpnia", wrzesnia: "września", pazdziernika: "października", listopada: "listopada", grudnia: "grudnia" };
        const pl = (s?: string) => s?.replace(/-/g, " ").replace(/[a-z]+/g, (w) => MONTHS[w] ?? w);
        const d = pl(slug.match(/z-dnia-(.+?)-r-w-sprawie/)?.[1]);
        const on = pl(slug.match(/-na-(.+?)-r$/)?.[1]);
        return { url: new URL(m[1], "https://www.gov.pl").toString(), title: `Obwieszczenie Ministra Zdrowia${d ? ` z ${d} r.` : ""} – wykaz leków refundowanych${on ? ` na ${on} r.` : ""}` };
      }
    }
  }
  throw new Error("refund list annex (.xlsx) not found");
}

// ------------------------------------------------------------------ cache + refresh

let current: Dataset | null = null;
let loading: Promise<Dataset> | null = null;

async function age(path: string): Promise<number> {
  try {
    return (Date.now() - (await stat(path)).mtimeMs) / 3_600_000;
  } catch {
    return Infinity;
  }
}

async function save(path: string, data: Buffer | string) {
  await writeFile(path + ".tmp", data);
  await rename(path + ".tmp", path);
}

async function build(forceDownload: boolean): Promise<Dataset> {
  await mkdir(config.dataDir, { recursive: true });
  const rplPath = join(config.dataDir, "rpl.csv");
  const refPath = join(config.dataDir, "refund.xlsx");
  const metaPath = join(config.dataDir, "refund.json");
  let meta: { url: string; title: string } = { url: "", title: "" };
  try {
    meta = JSON.parse(await readFile(metaPath, "utf8"));
  } catch {}
  if (forceDownload || (await age(rplPath)) > config.refreshHours) {
    try {
      const b = await fetchBuf(config.rplCsvUrl);
      if (b.length < 1_000_000) throw new Error(`RPL CSV too small (${b.length} B)`);
      await save(rplPath, b);
      log("info", `RPL downloaded (${(b.length / 1e6).toFixed(1)} MB)`);
    } catch (e) {
      log("warn", `RPL download failed: ${(e as Error).message}`);
    }
  }
  if (forceDownload || !meta.url || (await age(refPath)) > config.refreshHours) {
    try {
      const d = await discoverRefund();
      if (d.url !== meta.url || (await age(refPath)) === Infinity || forceDownload) {
        const b = await fetchBuf(d.url);
        readXlsx(b); // validate before replacing
        await save(refPath, b);
        log("info", `refund list downloaded: ${d.title}`);
      } else await save(refPath, await readFile(refPath)); // touch
      meta = d;
      await save(metaPath, JSON.stringify(meta));
    } catch (e) {
      log("warn", `refund list download failed: ${(e as Error).message}`);
    }
  }
  const [rplText, refBuf] = await Promise.all([readFile(rplPath, "utf8"), readFile(refPath)]);
  const products = parseRpl(rplText);
  const byGtin = new Map<string, { product: Product; pack: Pack }>();
  for (const p of products) for (const pk of p.packs) byGtin.set(normGtin(pk.gtin), { product: p, pack: pk });
  const { refund, free } = parseRefund(readXlsx(refBuf));
  log("info", `data: ${products.length} products, ${refund.length} refund rows`);
  return { products, byGtin, refund, free, refundTitle: meta.title, refundUrl: meta.url, loadedAt: new Date().toISOString() };
}

export async function data(): Promise<Dataset> {
  if (current) return current;
  loading ??= build(false).then((d) => (current = d)).finally(() => (loading = null));
  return loading;
}

/** Background refresh (keeps serving the old data while downloading). */
export function startRefresh() {
  const t = setInterval(() => {
    build(false)
      .then((d) => (current = d))
      .catch((e) => log("warn", `refresh failed: ${(e as Error).message}`));
  }, Math.max(1, config.refreshHours) * 3_600_000);
  t.unref();
}
