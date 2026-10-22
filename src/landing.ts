import { VERSION } from "./version.js";

const REPO = "https://github.com/ContentWriterco/leki-mcp";

export function landingHtml(base: string, stats: boolean): string {
  const mcp = `${base}/mcp`;
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>leki-mcp – ceny leków refundowanych, dopłaty i tańsze zamienniki dla AI (serwer MCP)</title>
<meta name="description" content="Darmowy serwer MCP z oficjalną listą leków refundowanych i Rejestrem Produktów Leczniczych. Zapytaj Claude albo ChatGPT, ile zapłacisz za lek na receptę i czy jest tańszy zamiennik.">
<link rel="canonical" href="${base}/">
<meta property="og:title" content="Ile zapłacę za lek i czy jest tańszy zamiennik? – lista leków refundowanych dla Twojego asystenta AI">
<meta property="og:description" content="Urzędowe ceny, dopłaty pacjenta i odpowiedniki z wykazu Ministra Zdrowia w Claude, ChatGPT i każdym kliencie MCP. Bez klucza API.">
<meta property="og:url" content="${base}/"><meta name="twitter:card" content="summary">
<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "leki-mcp",
    applicationCategory: "HealthApplication",
    operatingSystem: "Any",
    softwareVersion: VERSION,
    description: "MCP server with official prices of refunded medicines in Poland, patient co-payments and cheaper substitutes.",
    url: `${base}/`,
    codeRepository: REPO,
    license: "https://opensource.org/licenses/MIT",
    offers: { "@type": "Offer", price: "0", priceCurrency: "PLN" },
    publisher: { "@type": "Organization", name: "Compabase (Content Writer sp. z o.o.)", url: "https://compabase.com" },
  })}</script>
<style>
:root{--bg:#fff;--fg:#1f2328;--mut:#59636e;--card:#f6f8fa;--bd:#d1d9e0;--acc:#1a7f37}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--card:#151b23;--bd:#3d444d;--acc:#3fb950}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:860px;margin:0 auto;padding:48px 16px 64px}h1{font-size:38px;line-height:1.15;margin:0 0 12px}h1 span{color:var(--acc)}h2{font-size:22px;margin:36px 0 12px}
p.lead{font-size:19px;color:var(--mut);margin:0 0 24px}.ep{display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px 14px;font:15px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.ep code{flex:1;min-width:0;overflow-wrap:anywhere}button{font:600 14px inherit;font-family:inherit;padding:6px 12px;border-radius:8px;border:1px solid var(--bd);background:var(--bg);color:var(--fg);cursor:pointer}
pre{background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:14px;overflow:auto;font-size:13.5px;line-height:1.5;white-space:pre-wrap}li{margin:6px 0}a{color:var(--acc)}.small{color:var(--mut);font-size:14px}
</style></head><body><main>
<h1><span>leki</span>-mcp</h1>
<p class="lead">Ile zapłacisz w aptece za lek na receptę i czy jest tańszy odpowiednik? Oficjalna lista leków refundowanych Ministra Zdrowia i Rejestr Produktów Leczniczych w Claude, ChatGPT, Cursorze i każdym kliencie MCP. Za darmo, bez klucza API.</p>
<div class="ep"><code id="u">${mcp}</code><button onclick="navigator.clipboard.writeText(document.getElementById('u').textContent);this.textContent='Skopiowano'">Kopiuj adres MCP</button></div>
<h2>Przykład</h2>
<pre>Ty:    Biorę Tulip 20 mg, 30 tabletek. Ile za to płacę i czy jest coś tańszego?
Agent: Tulip 20 mg (30 szt.) kosztuje 15,52 zł, z refundacją 30% dopłacasz 8,64 zł.
       Ta sama atorwastatyna 20 mg, 30 szt. – np. Atorvastatin Medreg – to dopłata 2,49 zł (6,15 zł taniej).
       Najtaniej na tabletkę: opakowanie 90 szt. za 6,70 zł. Po 65. roku życia lek jest bezpłatny.</pre>
<p class="small">Dane z wykazu leków refundowanych na 1 października 2026 r.</p>
<h2>Jak podłączyć</h2>
<ul>
<li><b>Claude</b>: Ustawienia → Connectors → <i>Add custom connector</i> → wklej adres powyżej.</li>
<li><b>ChatGPT</b>: Settings → Connectors (tryb deweloperski) → dodaj serwer MCP z tym adresem.</li>
<li><b>Claude Code</b>: <code>claude mcp add --transport http leki ${mcp}</code></li>
<li><b>Lokalnie</b>: <code>npx -y leki-mcp</code></li>
</ul>
<h2>Co potrafi</h2>
<ul>
<li><b>drug_price</b> – urzędowa cena w aptece, limit NFZ, poziom odpłatności i dopłata pacjenta; tańsze odpowiedniki (ta sama substancja, dawka i liczba sztuk), najtańsze opakowanie w przeliczeniu na tabletkę; czy lek jest bezpłatny dla 65+, dzieci i kobiet w ciąży.</li>
<li><b>drug_info</b> – dane z Rejestru Produktów Leczniczych: substancja, dawka, postać, recepta czy OTC, opakowania z kodami EAN, link do ulotki i ChPL.</li>
<li><b>data_sources</b> – źródła i zastrzeżenia.</li>
</ul>
<p class="small">Dane: obwieszczenie Ministra Zdrowia w sprawie wykazu refundowanych leków (aktualizowane co kwartał) i Rejestr Produktów Leczniczych (e-Zdrowie). To informacja, nie porada medyczna – zmianę leku skonsultuj z lekarzem lub farmaceutą. Open source (MIT): <a href="${REPO}">GitHub</a>${stats ? ` · <a href="/stats">statystyki użycia</a> (anonimowe)` : ""} · wersja ${VERSION} · hostowane pro publico bono przez <a href="https://compabase.com">Compabase</a>.</p>
<p class="small" lang="en"><b>English:</b> free MCP server with official prices of refunded medicines in Poland, patient co-payments and cheaper substitutes (Ministry of Health refund list, Medicinal Products Register). Endpoint: <code>${mcp}</code></p>
</main></body></html>`;
}
