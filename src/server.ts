import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UserError, log } from "./config.js";
import { drugInfo, drugPrice } from "./drugs.js";
import { data } from "./data.js";
import { VERSION } from "./version.js";
import { usage, classify } from "./usage.js";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(tool: string, fn: () => Promise<string>): Promise<Text> {
  const t0 = performance.now();
  let res: Text;
  let userErr = false;
  try {
    res = { content: [{ type: "text", text: await fn() }] };
  } catch (e) {
    userErr = e instanceof UserError;
    const msg = userErr ? (e as Error).message : `Internal error: ${(e as Error).message}`;
    if (!userErr) log("error", (e as Error).stack);
    res = { content: [{ type: "text", text: msg }], isError: true };
  }
  if (usage.enabled) {
    const text = res.content[0].text;
    const outcome = /^Nie znaleziono/.test(text) ? "not_found" : /^Nie ma tego leku/.test(text) ? "no_result" : classify(text, !!res.isError, userErr);
    void usage.tool(tool, outcome, performance.now() - t0);
  }
  return res;
}

export const INSTRUCTIONS = `Polish medicines: official prices of refunded drugs, how much the patient pays (dopłata) and cheaper equivalents, from the Minister of Health refund list and the Medicinal Products Register (Rejestr Produktów Leczniczych).
Use drug_price for "how much will I pay", "is it refunded", "is there a cheaper substitute" – query with a brand name and strength ("Tulip 20 mg"), a substance in Polish or Latin ("atorwastatyna", "atorvastatinum"), optionally pack size ("30 szt"), or the EAN/GTIN barcode. Use drug_info for prescription status (Rx/OTC), registered packs and the leaflet link.
Explain that refunded prices are fixed nationwide, that the co-payment applies to a prescription with refund, and that the patient may ask the pharmacist for a cheaper equivalent unless the doctor wrote "NZ". Never recommend changing a medicine on your own – suggest asking a doctor or pharmacist. Answer in the user's language.`;

export function createServer(): McpServer {
  const server = new McpServer({ name: "leki-mcp", version: VERSION }, { instructions: INSTRUCTIONS });
  const ro = { readOnlyHint: true, openWorldHint: true } as const;

  server.registerTool(
    "drug_price",
    {
      title: "Refunded drug price, co-payment and cheaper substitutes (Poland)",
      description:
        "Official pharmacy price, NFZ refund limit, refund level and patient co-payment of a medicine on the Polish refund list, with cheaper equivalents (same substance, strength and pack size) and the cheapest price per tablet. " +
        "Also tells if the pack is free for seniors 65+, children under 18 or pregnant women. query: brand + strength (\"Tulip 20 mg\"), substance (\"atorwastatyna 20 mg\" / \"atorvastatinum\"), pack size (\"30 szt\") or EAN/GTIN.",
      inputSchema: {
        query: z.string().describe("Drug name / substance with optional strength and pack size, or EAN/GTIN"),
        indication: z.string().optional().describe("Disease or indication, when refund depends on it (e.g. 'cukrzyca')"),
        max: z.number().int().min(1).max(10).optional().describe("How many substitutes to list (default 5)"),
      },
      annotations: ro,
    },
    async (a) => run("drug_price", () => drugPrice({ query: a.query, indication: a.indication, max: a.max })),
  );

  server.registerTool(
    "drug_info",
    {
      title: "Medicine registration data (Poland)",
      description: "Data from the Polish Medicinal Products Register: substance, strength, form, ATC, marketing authorisation holder, prescription status (OTC / Rp / Rpz / Rpw / Lz), registered packs with EAN and links to the patient leaflet and SmPC.",
      inputSchema: { query: z.string().describe("Drug name, substance or EAN/GTIN"), max: z.number().int().min(1).max(15).optional() },
      annotations: ro,
    },
    async (a) => run("drug_info", () => drugInfo({ query: a.query, max: a.max })),
  );

  server.registerTool(
    "data_sources",
    { title: "Data sources", description: "Where the data comes from, how current it is, caveats.", inputSchema: {}, annotations: ro },
    async () =>
      run("data_sources", async () => {
        const d = await data();
        return [
          `Wykaz leków refundowanych: ${d.refundTitle || "Obwieszczenie Ministra Zdrowia"}${d.refundUrl ? ` – ${d.refundUrl}` : ""} (${d.refund.length} pozycji w aptece: leki, środki spożywcze specjalnego przeznaczenia, wyroby medyczne; listy bezpłatne 65+, do 18 lat i dla kobiet w ciąży).`,
          `Rejestr Produktów Leczniczych – Urząd Rejestracji Produktów Leczniczych / e-Zdrowie (rejestry.ezdrowie.gov.pl), ${d.products.length} produktów leczniczych stosowanych u ludzi.`,
          `Dane załadowane: ${d.loadedAt}; odświeżane codziennie. Wykaz refundacyjny zmienia się zwykle co kwartał (1 stycznia, kwietnia, lipca, października).`,
          "Ceny leków nierefundowanych (w tym OTC) są wolne i różnią się między aptekami – ich nie podajemy.",
          "To informacja, nie porada medyczna. Zmianę leku skonsultuj z lekarzem lub farmaceutą.",
          `leki-mcp ${VERSION} · https://github.com/ContentWriterco/leki-mcp`,
        ].join("\n");
      }),
  );
  return server;
}
