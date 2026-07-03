# Yarmouth Budget Explorer

**A public web tool that explains the Town of Yarmouth, Maine budget and lets
residents test property-tax-cut scenarios against the real, validated numbers.**

It answers the question every taxpayer actually has — *"what would it take to
lower my bill, and by how much?"* — by turning four years of town & school budget
books into a validated dataset, then wrapping it in:

- a **tabbed explainer** (where the FY27 money goes, and how a cut becomes a tax change),
- an **interactive scenario explorer** (cuts vs. new revenue, organized by what they
  touch — schools or town — and how much they'd move your bill), and
- an **"Ask the budget" chat** that evaluates any custom idea against the dataset,
  powered by the Anthropic API.

> ⚠️ FY2027 figures are a **draft**. This is a civic tool, not an official Town of
> Yarmouth resource, and AI answers can be wrong — verify against the official
> budget book before quoting.

---

## Repo layout

```
app/                     # the deployable web app (Vercel — see app/README.md)
  public/                #   static front-end (no build step)
    index.html, styles.css, app.js
    data.js              #   embedded dataset (generated)
  api/chat.js            #   Edge proxy: holds the Anthropic key, streams answers
  api/_budget-data.js    #   embedded dataset for the chat system prompt (generated)

build_data.py            # regenerates app/public/data.js + app/api/_budget-data.js from data/
data/                    # the validated Phase-1 datasets (CSV) — source of truth
*.pdf                    # the source budget books (public town documents)
parse_budget.py … analyze.py   # the parsing/validation pipeline (Phase 1)
build_scenarios.py       # builds data/scenarios.csv (the modeled cut/revenue ideas)
FINDINGS.md              # narrative analysis of the numbers
extracted/               # raw text dumps of each PDF (pypdf)
```

The web app and the chat read the **same** generated dataset, so the page and the
assistant can never disagree. Regenerate both after any data change:

```bash
python3 build_data.py
```

---

## The dataset (Phase 1)

Four town & school budget books (FY2024 approved → FY2027 draft) plus the detailed
FY27 school budget, parsed to a validated master dataset. Everything validates to
the dollar against the budgets' own published control totals.

- **Municipal** spending/revenue at the **GL line-item** level (~340 expenditure + ~30 revenue accounts).
- **Education** as function-level detail from the FY27 school book (the town books carry it as a lump sum);
  the level-4 school budget is parsed to the **object-line** level (1,218 lines) and reconciles to the cent.
- **County tax** is a single assessed pass-through the town can't set.

Key CSVs in `data/`: `summary_long.csv` (headline GF / levy / rate metrics),
`master_by_category.csv` & `school_functions.csv` (roll-ups),
`scenarios.csv` (the modeled cut/revenue ideas), plus the detailed line-item files.
See **`FINDINGS.md`** for the narrative.

### Numbers worth knowing (FY27)

- General Fund **~$65.6M** — **67%** education, **30%** municipal, **3%** county.
- The property-tax **levy is growing ~7.5%/yr**, faster than spending, because non-tax
  revenue covers a shrinking share.
- **Revaluation trap:** the rate fell $25.67 → $14.55 between FY25 and FY26 because the
  taxable base ~doubled — *not* a tax cut. Compare the **levy**, never the rate, across that boundary.
- ~**83%** of the school budget is salaries + benefits — the central constraint on cutting.
- **Conversion factor:** every **$1,000,000** cut ≈ **−$0.31** on the rate ≈ **−$155/year**
  on a $500k home (whose FY27 bill is ~$7,625).

### Pipeline (Phase 1, run in order)

```
python3 parse_budget.py        # PDFs → data/line_items_long.csv (municipal GL detail)
python3 build_summary.py       # → data/summary_long.csv
python3 build_master.py        # → data/master_*.csv
python3 build_school.py        # → data/school_functions.csv
python3 build_school_detail.py # → data/school_line_items.csv
python3 build_scenarios.py     # → data/scenarios.csv
python3 analyze.py             # → analysis/findings.txt
python3 build_data.py          # → app/public/data.js + app/api/_budget-data.js
```

---

## Running & deploying the app

- **Live-preview locally:** `cd app && vercel dev` (needs the Vercel CLI + `app/.env.local`
  with `ANTHROPIC_API_KEY`). Static-only preview without chat: `cd app/public && python3 -m http.server`.
- **Deploy:** push this repo to GitHub → import to Vercel → **set Root Directory to `app`** →
  add the `ANTHROPIC_API_KEY` env var. Full instructions, cost guardrails (spend cap,
  rate limiting, access word), and the model knob are in **[`app/README.md`](app/README.md)**.

---

## Data provenance

Source books: `FY24 …06.06.23.pdf`, `2024-2025 …06.04.24.pdf`, `2025-2026 …06.10.25.pdf`,
`2026-2027 DRAFT …04.09.26 Citizens 05.04.26.pdf`, and `FY27 Full School Budget lvl 4.pdf`.
Fiscal years end in June ("FY27" = July 2026–June 2027). The dataset is built on the
**04.09 "Citizens" draft** book; the later 4.26 presentation differs slightly.

*Not affiliated with the Town of Yarmouth.*
