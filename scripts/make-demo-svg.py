#!/usr/bin/env python3
"""
Generates the animated README demo (docs/demo-pl.svg, docs/demo-en.svg): a user asks about a medicine,
the agent calls drug_price and answers with the co-payment, cheaper equivalents and the cheapest pack per tablet.
Content = a real answer of the public server (Tulip 20 mg, 30 tabl.; refund list for 1 Oct 2026).
Pure SVG + SMIL, adapts to light/dark mode.
Usage: python3 scripts/make-demo-svg.py
"""
import os
from xml.sax.saxutils import escape

W, CW = 860, 8.45   # width, monospace char width (approx.)
LOOP = 20.0         # seconds
X0 = 28

# co-payment bars (zł): asked drug vs cheaper equivalents
TREND = [("Tulip", 8.64), ("Atorvastatin Medreg", 2.49), ("Atorvox", 2.49), ("Atorv. Aurovitas", 3.07), ("Atoris", 7.81)]

TEXT = {
    "pl": {
        "title": "Claude · leki-mcp",
        "you": "Ty", "agent": "Agent",
        "q": "Biorę Tulip 20 mg, 30 tabletek. Ile płacę i czy jest coś tańszego?",
        "tool": 'drug_price(query: "Tulip 20 mg 30 szt")',
        "done": "wykaz leków refundowanych na 1.10.2026 · 12 tańszych odpowiedników",
        "intro": "Tulip 20 mg (30 szt.): cena 15,52 zł, z refundacją 30% dopłacasz 8,64 zł.",
        "rows": [
            ("taniej", "Atorvastatin Medreg 20 mg, 30 szt. – dopłata 2,49 zł (6,15 zł mniej)"),
            ("na szt.", "najtaniej 90 szt. za 6,70 zł – 0,07 zł zamiast 0,29 zł za tabletkę"),
            ("65+", "po 65. roku życia lek jest bezpłatny (recepta z uprawnieniem)"),
        ],
        "chart": "Dopłata pacjenta za 30 tabletek atorwastatyny 20 mg",
        "fmt": lambda v: f"{v:.2f}".replace(".", ",") + " zł",
        "note": "Ceny urzędowe – takie same w każdej aptece. Poproś farmaceutę o tańszy odpowiednik.",
        "aria": "Animacja: użytkownik pyta agenta AI, ile płaci za lek Tulip 20 mg i czy jest tańszy; agent wywołuje drug_price z leki-mcp i podaje dopłatę 8,64 zł, tańszy odpowiednik za 2,49 zł, najtańsze opakowanie na tabletkę i wykres dopłat różnych odpowiedników.",
    },
    "en": {
        "title": "Claude · leki-mcp",
        "you": "You", "agent": "Agent",
        "q": "I take Tulip 20 mg, 30 tablets. What do I pay and is there anything cheaper?",
        "tool": 'drug_price(query: "Tulip 20 mg 30 szt")',
        "done": "refund list of 1 Oct 2026 · 12 cheaper equivalents",
        "intro": "Tulip 20 mg (30 tabs): price 15.52 zł, with 30% refund you pay 8.64 zł.",
        "rows": [
            ("cheaper", "Atorvastatin Medreg 20 mg, 30 tabs – you pay 2.49 zł (6.15 zł less)"),
            ("per tab", "cheapest 90-tab pack: 6.70 zł – 0.07 zł instead of 0.29 zł a tablet"),
            ("65+", "free for patients aged 65+ (prescription with entitlement)"),
        ],
        "chart": "Patient co-payment for 30 tablets of atorvastatin 20 mg",
        "fmt": lambda v: f"{v:.2f} zł",
        "note": "Official prices – the same in every pharmacy. Ask the pharmacist for the cheaper one.",
        "aria": "Animation: a user asks an AI agent what they pay for Tulip 20 mg and whether there is something cheaper; the agent calls drug_price from leki-mcp and answers with the 8.64 zł co-payment, a 2.49 zł equivalent, the cheapest pack per tablet and a bar chart of co-payments.",
    },
}

T_TYPE0, T_TYPE1 = 0.6, 3.6
T_TOOL, T_TOOLDONE = 4.1, 5.6
T_ANS0, T_STEP = 6.1, 0.55
T_FADE = 18.6


def kt(t):
    return f"{t / LOOP:.4f}"


def appear(t, fade=0.25):
    return (f'<animate attributeName="opacity" dur="{LOOP}s" repeatCount="indefinite" '
            f'values="0;0;1;1;0;0" keyTimes="0;{kt(t)};{kt(t + fade)};{kt(T_FADE)};{kt(T_FADE + 0.5)};1"/>')


def grow(attr, full, t, base=None, dur=0.6):
    """animate a bar's height (and y) from 0 to full starting at t"""
    if base is None:
        vals = f"0;0;{full};{full};0;0"
    else:
        vals = f"{base};{base};{base - full};{base - full};{base};{base}"
    return (f'<animate attributeName="{attr}" dur="{LOOP}s" repeatCount="indefinite" '
            f'values="{vals}" keyTimes="0;{kt(t)};{kt(t + dur)};{kt(T_FADE)};{kt(T_FADE + 0.5)};1"/>')


def typing(clip_id, n, x):
    widths, times = [0], [0.0]
    for i in range(n + 1):
        widths.append(round(i * CW + 2, 1))
        times.append((T_TYPE0 + (T_TYPE1 - T_TYPE0) * i / n) / LOOP)
    widths += [n * CW + 2, 0]
    times += [(T_FADE + 0.5) / LOOP, 1.0]
    return (f'<clipPath id="{clip_id}"><rect x="{x}" y="0" height="2000" width="0">'
            f'<animate attributeName="width" dur="{LOOP}s" repeatCount="indefinite" calcMode="discrete" '
            f'values="{";".join(str(w) for w in widths)}" keyTimes="{";".join(f"{t:.4f}" for t in times)}"/>'
            f'</rect></clipPath>')


def svg(lang):
    t = TEXT[lang]
    H_HEADER = 44
    y = H_HEADER + 34
    body, defs = [], []

    body.append(f'<text class="label" x="{X0}" y="{y}">{escape(t["you"])}</text>')
    y += 24
    body.append(f'<rect class="bubble" x="{X0 - 10}" y="{y - 19}" width="{len(t["q"]) * CW + 30}" height="30" rx="8"/>')
    defs.append(typing("type", len(t["q"]), X0 + 4))
    body.append(f'<g clip-path="url(#type)"><text class="q" x="{X0 + 4}" y="{y}">{escape(t["q"])}</text></g>')
    y += 46

    body.append(f'<g opacity="0">{appear(T_TOOL)}'
                f'<rect class="tool" x="{X0 - 10}" y="{y - 19}" width="{len(t["tool"]) * CW + 64}" height="30" rx="15"/>'
                f'<text class="toolic" x="{X0 + 4}" y="{y}">⚙</text>'
                f'<text class="toolt" x="{X0 + 26}" y="{y}">{escape(t["tool"])}</text></g>')
    dx = X0 + len(t["tool"]) * CW + 72
    body.append(f'<g opacity="0"><animate attributeName="opacity" dur="{LOOP}s" repeatCount="indefinite" '
                f'values="0;0;1;1;0;0" keyTimes="0;{kt(T_TOOL)};{kt(T_TOOL + 0.1)};{kt(T_TOOLDONE)};{kt(T_TOOLDONE + 0.05)};1"/>'
                + "".join(f'<circle class="dot" cx="{dx + i * 10}" cy="{y - 4}" r="3"><animate attributeName="opacity" values="0.2;1;0.2" dur="0.9s" begin="{i * 0.15}s" repeatCount="indefinite"/></circle>' for i in range(3))
                + "</g>")
    y += 30
    body.append(f'<g opacity="0">{appear(T_TOOLDONE)}<text class="ok" x="{X0 + 4}" y="{y}">✓ {escape(t["done"])}</text></g>')
    y += 44

    ta = T_ANS0
    body.append(f'<g opacity="0">{appear(ta)}<text class="label" x="{X0}" y="{y}">{escape(t["agent"])}</text></g>')
    y += 26
    body.append(f'<g opacity="0">{appear(ta)}<text class="big" x="{X0}" y="{y}">{escape(t["intro"])}</text></g>')
    y += 10
    for tag, line in t["rows"]:
        ta += T_STEP
        y += 32
        pw = 76
        body.append(f'<g opacity="0">{appear(ta)}'
                    f'<rect class="pill" x="{X0}" y="{y - 17}" width="{pw}" height="22" rx="11"/>'
                    f'<text class="pillt" x="{X0 + pw / 2}" y="{y - 1}" text-anchor="middle">{escape(tag)}</text>'
                    f'<text class="a" x="{X0 + pw + 14}" y="{y}">{escape(line)}</text></g>')

    # trend chart
    ta += T_STEP
    y += 44
    body.append(f'<g opacity="0">{appear(ta)}<text class="muted" x="{X0}" y="{y}">{escape(t["chart"])}</text></g>')
    y += 14
    ch, bw, gap = 110, 70, 34
    base = y + ch
    vmax = max(v for _, v in TREND)
    bw, gap = 130, 30
    body.append(f'<g opacity="0">{appear(ta)}<line class="axis" x1="{X0}" y1="{base}" x2="{X0 + len(TREND) * (bw + gap)}" y2="{base}"/></g>')
    for i, (yr, v) in enumerate(TREND):
        tb = ta + 0.25 + i * 0.22
        x = X0 + 6 + i * (bw + gap)
        h = round(ch * v / vmax, 1)
        cls = "bar hi" if i == 0 else "bar"
        body.append(f'<rect class="{cls}" x="{x}" y="{base}" width="{bw}" height="0" rx="4">'
                    f'{grow("height", h, tb)}{grow("y", h, tb, base=base)}</rect>')
        body.append(f'<g opacity="0">{appear(tb + 0.5)}'
                    f'<text class="val" x="{x + bw / 2}" y="{base - h - 7}" text-anchor="middle">{escape(t["fmt"](v))}</text></g>')
        body.append(f'<g opacity="0">{appear(ta)}<text class="yr" x="{x + bw / 2}" y="{base + 18}" text-anchor="middle">{escape(str(yr))}</text></g>')
    y = base + 18
    ta += 0.25 + len(TREND) * 0.22 + 0.4
    y += 34
    body.append(f'<g opacity="0">{appear(ta)}<text class="note" x="{X0}" y="{y}">{escape(t["note"])}</text></g>')
    H = y + 30

    style = """
  .bg{fill:#ffffff;stroke:#d0d7de}
  .hdr{fill:#f6f8fa}
  .hdrt{fill:#57606a;font:600 13px -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}
  text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono','Liberation Mono',monospace;font-size:14px}
  .label{fill:#6e7781;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
  .bubble{fill:#ddf4ff;stroke:#b6e3ff}
  .q{fill:#0b2a4a}
  .tool{fill:#f6f8fa;stroke:#d0d7de}
  .toolic{fill:#8250df}
  .toolt{fill:#24292f;font-size:13px}
  .dot{fill:#8250df}
  .ok{fill:#1a7f37;font-size:13px}
  .big{fill:#24292f;font-weight:700}
  .a{fill:#24292f}
  .pill{fill:#0969da}
  .pillt{fill:#ffffff;font-size:12px;font-weight:700}
  .muted{fill:#57606a;font-size:12px;font-weight:600;letter-spacing:.03em;text-transform:uppercase}
  .axis{stroke:#d0d7de;stroke-width:1.5}
  .bar{fill:#4ac26b}.bar.hi{fill:#cf222e}
  .val{fill:#24292f;font-size:12px;font-weight:600}
  .yr{fill:#57606a;font-size:11px}
  .note{fill:#1a7f37;font-size:13px}
  @media (prefers-color-scheme: dark){
    .bg{fill:#0d1117;stroke:#30363d}.hdr{fill:#161b22}.hdrt{fill:#8b949e}
    .label,.muted,.yr{fill:#8b949e}.bubble{fill:#0c2d4a;stroke:#1f6feb}.q{fill:#cae8ff}
    .tool{fill:#161b22;stroke:#30363d}.toolt{fill:#c9d1d9}.toolic,.dot{fill:#bc8cff}
    .ok,.note{fill:#3fb950}.a,.big,.val{fill:#e6edf3}.axis{stroke:#30363d}
    .pill{fill:#1f6feb}.bar{fill:#2ea043}.bar.hi{fill:#f85149}
  }"""
    head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="{escape(t["aria"])}">'
            f'<title>{escape(t["aria"])}</title><style>{style}</style><defs>{"".join(defs)}</defs>'
            f'<rect class="bg" x="0.5" y="0.5" width="{W - 1}" height="{H - 1}" rx="12"/>'
            f'<path class="hdr" d="M12.5 0.5 H{W - 12.5} A12 12 0 0 1 {W - 0.5} 12.5 V{H_HEADER} H0.5 V12.5 A12 12 0 0 1 12.5 0.5 Z"/>'
            + "".join(f'<circle cx="{22 + i * 18}" cy="22" r="6" fill="{c}"/>' for i, c in enumerate(["#ff5f57", "#febc2e", "#28c840"]))
            + f'<text class="hdrt" x="{W / 2}" y="27" text-anchor="middle">{escape(t["title"])}</text>')
    return head + "".join(body) + "</svg>\n"


here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs")
os.makedirs(here, exist_ok=True)
for lang in TEXT:
    p = os.path.join(here, f"demo-{lang}.svg")
    with open(p, "w", encoding="utf-8") as f:
        f.write(svg(lang))
    print("wrote", os.path.normpath(p))
