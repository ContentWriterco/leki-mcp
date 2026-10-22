import { UserError } from "./config.js";
import { data, normGtin, type Dataset, type Product, type RefundRow } from "./data.js";

// ------------------------------------------------------------------ text matching

/** Lowercase, no diacritics, Polish spelling -> Latin-ish (amoksycylina ~ amoxicillinum, lewotyroksyna ~ levothyroxinum). */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ks/g, "x")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/w/g, "v")
    .replace(/cy/g, "ci")
    .replace(/y/g, "i")
    .replace(/ae/g, "e")
    .replace(/(.)\1/g, "$1");
}

const ENDINGS = /(um|us|i|a|e|o|ae|is)$/;
export const stem = (w: string) => (w.length > 5 ? w.replace(ENDINGS, "") : w);

const STOP = new Set(["mg", "g", "ug", "mcg", "ml", "tabl", "tabletki", "tabletka", "kaps", "kapsulki", "lek", "leku", "na", "w", "z", "i", "do", "cena", "ile", "kosztuje", "szt", "powl", "op", "opakowanie", "refundacja", "zamiennik", "zamienniki"].map(fold));

export interface ParsedQuery {
  words: string[];
  /** bare numbers ("Euthyrox N 50") */
  numbers?: string[];
  strength?: string;
  count?: number;
  gtin?: string;
}

export function parseQuery(q: string): ParsedQuery {
  const s = q.trim();
  const g = s.replace(/\s/g, "");
  if (/^\d{8,14}$/.test(g)) return { words: [], gtin: normGtin(g) };
  const sm = s.match(/(\d+(?:[.,]\d+)?(?:\s*\+\s*\d+(?:[.,]\d+)?)*)\s*(mg|g|µg|μg|mcg|ug|ml|j\.?\s?m\.?|%)/i);
  const strength = sm ? `${sm[1].replace(/\s/g, "").replace(".", ",")} ${sm[2].toLowerCase().replace(/^(mcg|ug|μg)$/, "µg").replace(/\s/g, "")}` : undefined;
  const cm = s.match(/(\d+)\s*(szt|tabl|kaps|sasz)/i);
  const rest = s.replace(sm?.[0] ?? "\u0000", " ").replace(cm?.[0] ?? "\u0000", " ");
  const all = fold(rest).split(/[^a-z0-9]+/);
  const words = all.filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w));
  const numbers = all.filter((w) => /^\d+$/.test(w));
  return { words, numbers: numbers.length ? numbers : undefined, strength, count: cm ? +cm[1] : undefined };
}

const tokens = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);

function wordHit(q: string, toks: string[]): number {
  const qs = stem(q);
  let best = 0;
  for (const t of toks) {
    if (t === q) return 3;
    const ts = stem(t);
    if (ts === qs) best = Math.max(best, 2.5);
    else if (qs.length >= 4 && (ts.startsWith(qs) || (ts.length >= 5 && qs.startsWith(ts)))) best = Math.max(best, 2);
  }
  return best;
}

/** score > 0 when every query word hits the brand or the substance; brand hits are flagged. */
function score(q: ParsedQuery, brand: string, substance: string): { s: number; brandHit: boolean } {
  if (!q.words.length) return { s: 0, brandHit: false };
  const bt = tokens(brand);
  const st = tokens(substance);
  let s = 0;
  let brandHit = false;
  for (const w of q.words) {
    const b = wordHit(w, bt);
    const sub = wordHit(w, st);
    if (!b && !sub) return { s: 0, brandHit: false };
    if (b >= sub) brandHit = true;
    s += Math.max(b, sub);
  }
  return { s, brandHit };
}

const normStrength = (s: string) => s.toLowerCase().replace(/\s/g, "").replace(/\./g, ",").replace(/mcg|ug|μg/g, "µg");

// ------------------------------------------------------------------ refund rows helpers

export function labelParts(label: string): { brand: string; form: string; strength: string } {
  const parts = label.split(",").map((x) => x.trim());
  const brand = parts[0] ?? label;
  const strength = parts.slice(1).filter((p) => /\d/.test(p) && /(mg|µg|g|ml|j\.m|%|mmol|jm)/i.test(p)).join(", ");
  const form = parts.slice(1).filter((p) => !(/\d/.test(p) && /(mg|µg|g|ml|j\.m|%|mmol|jm)/i.test(p))).join(", ");
  return { brand, form, strength };
}

export function packCount(content: string): number {
  const m = content.match(/^(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(",", ".")) : NaN;
}

const zl = (v: number) => (Number.isFinite(v) ? `${v.toFixed(2).replace(".", ",")} zł` : "–");
const ALL = /wszystkich zarejestrowanych wskazaniach/i;
const indKey = (s: string) => fold(s.replace(/<\d+>/g, " ")).replace(/[^a-z0-9]/g, "");
const sameInd = (a: RefundRow, b: RefundRow) => ALL.test(a.indication) || indKey(a.indication) === indKey(b.indication);

/** One package (gtin) can appear in several rows (different indications / levels). Main row = all indications, else the cheapest. */
function mainRow(rows: RefundRow[]): RefundRow {
  return rows.find((r) => ALL.test(r.indication)) ?? [...rows].sort((a, b) => a.copay - b.copay)[0];
}

function byGtin(rows: RefundRow[]): Map<string, RefundRow[]> {
  const m = new Map<string, RefundRow[]>();
  for (const r of rows) (m.get(r.gtin) ?? m.set(r.gtin, []).get(r.gtin)!).push(r);
  return m;
}

function freeFor(d: Dataset, gtin: string): string[] {
  const out: string[] = [];
  if (d.free.senior.has(gtin)) out.push("65+");
  if (d.free.child.has(gtin)) out.push("dzieci i młodzież do 18 lat");
  if (d.free.pregnant.has(gtin)) out.push("kobiety w ciąży");
  return out;
}

function rxCat(d: Dataset, gtin: string): string | undefined {
  return d.byGtin.get(gtin)?.pack.cat;
}

const CAT: Record<string, string> = {
  OTC: "bez recepty (OTC)",
  Rp: "na receptę (Rp)",
  Rpz: "na receptę do zastrzeżonego stosowania (Rpz)",
  Rpw: "na receptę, zawiera substancje kontrolowane (Rpw)",
  Lz: "tylko w lecznictwie zamkniętym – szpital (Lz)",
};

// ------------------------------------------------------------------ drug_price

export interface PriceQuery {
  query: string;
  indication?: string;
  max?: number;
}

export async function drugPrice(pq: PriceQuery): Promise<string> {
  const d = await data();
  const q = parseQuery(pq.query);
  let rows: RefundRow[];
  let brandMode = false;
  if (q.gtin) {
    rows = d.refund.filter((r) => r.gtin === q.gtin);
    brandMode = true;
  } else {
    const scored = d.refund.map((r) => ({ r, ...score(q, labelParts(r.label).brand, r.substance) })).filter((x) => x.s > 0);
    const top = Math.max(0, ...scored.map((x) => x.s));
    const best = scored.filter((x) => x.s >= top - 0.01);
    brandMode = best.some((x) => x.brandHit) && best.every((x) => x.brandHit || false);
    rows = best.map((x) => x.r);
  }
  if (q.strength) {
    const want = normStrength(q.strength);
    const exact = rows.filter((r) => normStrength(labelParts(r.label).strength) === want);
    rows = exact.length ? exact : rows.filter((r) => normStrength(labelParts(r.label).strength).includes(want));
  }
  if (q.count) rows = rows.filter((r) => packCount(r.content) === q.count);
  if (q.numbers && !q.strength) {
    const f = rows.filter((r) => q.numbers!.every((n) => tokens(r.label).includes(n)));
    if (f.length) rows = f;
  }
  if (!rows.length) {
    const info = await drugInfo({ query: pq.query, max: 3 }).catch(() => "");
    if (info && !/^Nie znaleziono/.test(info)) {
      // refunded products with the same substance (and strength) – often a cheaper way to get the same medicine
      const prod = findProducts(d, q)[0];
      let alt = "";
      if (prod?.inn) {
        const inn = fold(prod.inn);
        const st = normStrength(prod.strength);
        const same = d.refund.filter((r) => fold(r.substance) === inn && (!st || normStrength(labelParts(r.label).strength) === st));
        if (same.length) {
          const best = [...byGtin(same).values()].map(mainRow).sort((a, b) => a.copay / (packCount(a.content) || 1) - b.copay / (packCount(b.content) || 1)).slice(0, 5);
          alt = `\n\nRefundowane są natomiast inne leki z tą samą substancją (${prod.inn} ${prod.strength}) – np.:\n${best.map((r) => `- ${r.label} · ${r.content}: cena ${zl(r.retail)}, dopłata ${zl(r.copay)} (${r.level})${ALL.test(r.indication) ? "" : ` – tylko we wskazaniu: ${r.indication.replace(/<\d+>/g, "").slice(0, 80)}…`}`).join("\n")}\nZapytaj lekarza o receptę na refundowany odpowiednik.`;
        }
      }
      return `Nie ma tego leku (w tej dawce/opakowaniu) w wykazie leków refundowanych – płaci się pełną cenę apteki (ceny leków nierefundowanych są wolne i różnią się między aptekami).${alt}\n\n${info}`;
    }
    throw new UserError(`Nie znaleziono leku "${pq.query}". Podaj nazwę handlową (np. "Tulip 20 mg"), substancję (np. "atorwastatyna", także po łacinie "atorvastatinum") albo kod EAN/GTIN z opakowania.`);
  }
  if (pq.indication) {
    const iw = tokens(pq.indication).filter((w) => w.length > 3);
    const f = rows.filter((r) => ALL.test(r.indication) || iw.some((w) => tokens(r.indication + " " + r.offLabel).some((t) => stem(t).startsWith(stem(w)))));
    if (f.length) rows = f;
  }
  const L: string[] = [];
  const max = Math.max(1, Math.min(10, pq.max ?? 5));

  // equivalence group: same limit group + substance + strength + pack size
  const eqKey = (r: RefundRow) => `${r.limitGroup}|${fold(r.substance)}|${normStrength(labelParts(r.label).strength)}|${packCount(r.content)}`;
  const strengthKey = (r: RefundRow) => `${r.limitGroup}|${fold(r.substance)}|${normStrength(labelParts(r.label).strength)}`;

  if (brandMode) {
    const groups = byGtin(rows);
    const shown = [...groups.entries()].slice(0, 6);
    for (const [gtin, rs] of shown) {
      const m = mainRow(rs);
      L.push(`${m.label} · ${m.content} · EAN ${gtin.padStart(13, "0")}${rxCat(d, gtin) ? ` · ${CAT[rxCat(d, gtin)!] ?? rxCat(d, gtin)}` : ""}`);
      L.push(`  Cena w aptece (urzędowa): ${zl(m.retail)} · limit NFZ: ${zl(m.limit)} · odpłatność: ${m.level} → dopłacasz ${zl(m.copay)}${ALL.test(m.indication) ? "" : ` (wskazanie: ${m.indication.slice(0, 160)})`}`);
      const other = rs.filter((r) => r !== m);
      if (other.length)
        L.push(`  Inne wskazania refundacyjne: ${other.slice(0, 4).map((r) => `${r.indication.slice(0, 90)}${r.offLabel ? ` (poza ChPL: ${r.offLabel.slice(0, 60)})` : ""} – ${r.level}, dopłata ${zl(r.copay)}`).join("; ")}${other.length > 4 ? ` … (+${other.length - 4})` : ""}`);
      const free = freeFor(d, gtin);
      if (free.length) L.push(`  Bezpłatnie (recepta z uprawnieniem) dla: ${free.join(", ")}`);
      // substitutes: same equivalence group, same (main) indication
      const eqAll = d.refund.filter((r) => eqKey(r) === eqKey(m) && r.gtin !== gtin);
      let eq = eqAll.filter((r) => sameInd(r, m));
      const otherInd = !eq.length && eqAll.length > 0;
      if (otherInd) eq = eqAll;
      const pick = (rs: RefundRow[]) => rs.find((r) => sameInd(r, m)) ?? mainRow(rs);
      const cheaper = [...byGtin(eq).values()].map(pick).filter((r) => r.copay < m.copay - 0.005).sort((a, b) => a.copay - b.copay);
      if (cheaper.length) {
        L.push(`  Tańsze odpowiedniki (ta sama substancja, dawka i liczba sztuk; ${cheaper.length})${otherInd ? " – uwaga: zakres refundowanych wskazań się różni, sprawdź z lekarzem" : ""}:`);
        for (const r of cheaper.slice(0, max)) L.push(`   - ${r.label} · ${r.content}: dopłata ${zl(r.copay)} (taniej o ${zl(m.copay - r.copay)})`);
      } else L.push("  To najtańsza opcja w tej dawce i wielkości opakowania (wśród refundowanych odpowiedników).");
      // cheapest per unit across pack sizes
      const sameStrength = [...byGtin(d.refund.filter((r) => strengthKey(r) === strengthKey(m) && sameInd(r, m))).values()].map(mainRow);
      const perUnit = sameStrength.filter((r) => packCount(r.content) > 0).sort((a, b) => a.copay / packCount(a.content) - b.copay / packCount(b.content))[0];
      if (perUnit && perUnit.gtin !== gtin && packCount(perUnit.content) !== packCount(m.content))
        L.push(`  Najtaniej w przeliczeniu na sztukę: ${perUnit.label} · ${perUnit.content} – ${zl(perUnit.copay)} (${zl(perUnit.copay / packCount(perUnit.content))}/szt. vs ${zl(m.copay / packCount(m.content))}/szt.)`);
      L.push("");
    }
    if (groups.size > shown.length) L.push(`(+${groups.size - shown.length} innych opakowań – doprecyzuj dawkę lub liczbę sztuk)`, "");
  } else {
    // substance search: cheapest per strength + pack size
    const byStrength = new Map<string, RefundRow[]>();
    for (const r of rows) (byStrength.get(strengthKey(r)) ?? byStrength.set(strengthKey(r), []).get(strengthKey(r))!).push(r);
    const keys = [...byStrength.keys()].slice(0, 6);
    L.push(`Refundowane leki z substancją: ${[...new Set(rows.map((r) => r.substance))].slice(0, 3).join(", ")}`, "");
    for (const k of keys) {
      const rs = byStrength.get(k)!;
      const sample = rs[0];
      L.push(`${labelParts(sample.label).strength || "?"} · ${labelParts(sample.label).form} · grupa limitowa ${sample.limitGroup.split(",")[0]}`);
      const bySize = new Map<number, RefundRow[]>();
      for (const r of [...byGtin(rs).values()].map(mainRow)) (bySize.get(packCount(r.content)) ?? bySize.set(packCount(r.content), []).get(packCount(r.content))!).push(r);
      for (const [n, list] of [...bySize.entries()].sort((a, b) => a[0] - b[0])) {
        list.sort((a, b) => a.copay - b.copay);
        const lo = list[0];
        const hi = list[list.length - 1];
        L.push(
          `  ${n} szt.: najtaniej ${lo.label.split(",")[0]} – dopłata ${zl(lo.copay)} (${lo.level}, cena ${zl(lo.retail)})${list.length > 1 ? `; najdrożej ${hi.label.split(",")[0]} ${zl(hi.copay)} (pozycji: ${list.length})` : ""}`,
        );
        for (const r of list.slice(1, Math.min(list.length, max))) if (r.copay < hi.copay || list.length <= max) L.push(`     · ${r.label.split(",")[0]} ${zl(r.copay)}`);
      }
      const notAll = rs.filter((r) => !ALL.test(r.indication));
      if (notAll.length) L.push(`  Uwaga: część refundacji dotyczy tylko określonych wskazań (np. ${notAll[0].indication.slice(0, 100)}).`);
      L.push("");
    }
    if (byStrength.size > keys.length) L.push(`(+${byStrength.size - keys.length} innych dawek/postaci – podaj dawkę, np. "20 mg")`, "");
  }
  L.push(
    "Ceny leków refundowanych są urzędowe – takie same w każdej aptece. Dopłata dotyczy recepty z refundacją; bez niej płacisz pełną cenę.",
    "Farmaceuta ma obowiązek poinformować o tańszym odpowiedniku i wydać go na Twoje życzenie, chyba że lekarz zaznaczył na recepcie „nie zamieniać” (NZ). Zmianę leku skonsultuj z lekarzem lub farmaceutą.",
    `Źródło: ${d.refundTitle || "wykaz leków refundowanych Ministra Zdrowia"}${d.refundUrl ? ` (${d.refundUrl})` : ""}; Rejestr Produktów Leczniczych.`,
  );
  return L.join("\n");
}

// ------------------------------------------------------------------ drug_info (RPL)

function findProducts(d: Dataset, q: ParsedQuery): Product[] {
  let prods: Product[];
  if (q.gtin) {
    const hit = d.byGtin.get(q.gtin);
    prods = hit ? [hit.product] : [];
  } else {
    const scored = d.products.map((p) => ({ p, ...score(q, p.name, `${p.inn} ${p.substance}`) })).filter((x) => x.s > 0);
    const top = Math.max(0, ...scored.map((x) => x.s));
    prods = scored.filter((x) => x.s >= top - 0.01).map((x) => x.p);
    if (q.strength) {
      const want = normStrength(q.strength);
      const exact = prods.filter((p) => normStrength(p.strength) === want);
      prods = exact.length ? exact : prods.filter((p) => normStrength(p.strength).includes(want));
    } else if (q.numbers) {
      const f = prods.filter((p) => q.numbers!.every((n) => tokens(`${p.name} ${p.strength}`).includes(n)));
      if (f.length) prods = f;
    }
  }
  // registered, not cancelled
  return prods.filter((p) => p.packs.some((pk) => pk.cat !== "Skasowane"));
}

export async function drugInfo(a: { query: string; max?: number }): Promise<string> {
  const d = await data();
  const q = parseQuery(a.query);
  const prods = findProducts(d, q);
  if (!prods.length) return `Nie znaleziono "${a.query}" w Rejestrze Produktów Leczniczych.`;
  const refunded = new Set(d.refund.map((r) => r.gtin));
  const max = Math.max(1, Math.min(15, a.max ?? 6));
  const L: string[] = [`Znaleziono ${prods.length} produkt(ów) w Rejestrze Produktów Leczniczych${prods.length > max ? ` – pokazuję ${max}` : ""}:`, ""];
  for (const p of prods.slice(0, max)) {
    const cats = [...new Set(p.packs.map((pk) => pk.cat).filter((c) => c !== "Skasowane"))];
    L.push(`${p.name} ${p.strength} · ${p.form}`);
    L.push(`  Substancja: ${p.inn || p.substance}${p.atc ? ` · ATC ${p.atc}` : ""} · podmiot odpowiedzialny: ${p.holder}`);
    L.push(`  Dostępność: ${cats.map((c) => CAT[c] ?? c).join("; ") || "–"}`);
    const packs = p.packs.filter((pk) => pk.cat !== "Skasowane").slice(0, 6);
    L.push(`  Opakowania: ${packs.map((pk) => `${pk.content || "?"} (EAN ${pk.gtin}${refunded.has(normGtin(pk.gtin)) ? ", refundowany" : ""})`).join("; ")}`);
    if (p.leaflet) L.push(`  Ulotka: ${p.leaflet}`);
    if (p.spc) L.push(`  Charakterystyka (ChPL): ${p.spc}`);
    L.push("");
  }
  L.push("Źródło: Rejestr Produktów Leczniczych (rejestry.ezdrowie.gov.pl). Informacje nie zastępują porady lekarza ani farmaceuty.");
  return L.join("\n");
}
