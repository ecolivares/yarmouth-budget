# Yarmouth, ME Town Budget — Master Dataset & Analysis

Reads four years of Yarmouth town & school budget books (FY2024–FY2027 draft)
plus the detailed FY27 school budget, parses them into a validated master
dataset, and explores spend, growth, revenue, and property-tax cut scenarios.

**Phase 1 (this repo):** build + validate the dataset, exploratory analysis,
canned tax-cut scenarios.
**Phase 2 (not started):** turn it into an interactive LLM-driven artifact.

## Source documents (`*.pdf`)
| File | Role |
|---|---|
| `FY24 Town & School Budget …06.06.23.pdf` | FY2024 approved book |
| `2024-2025 …06.04.24.pdf` | FY2025 approved book |
| `2025-2026 …06.10.25.pdf` | FY2026 approved book |
| `2026-2027 DRAFT …04.09.26 Citizens 05.04.26.pdf` | FY2027 **draft** book (primary) |
| `FY27 Full School Budget lvl 4.pdf` | FY27 detailed school budget (function/line level) |
| `FY27 Budget Presentation 4.26.26.pdf` | Citizen presentation (slightly later iteration) |

Note: fiscal years end in June. "FY27" = July 2026–June 2027. The FY27 figures
are a **draft**; the 04.09 book and the 4.26 presentation differ slightly
(e.g. municipal $19.561M vs $19.626M; rate $15.25 vs $15.30). This dataset is
built on the **04.09 "Citizens" draft book**.

## Pipeline (run in order)
```
python3 parse_budget.py   # PDFs → data/line_items_long.csv   (municipal GL detail)
python3 build_summary.py  # → data/summary_long.csv           (GF / tax-rate roll-up)
python3 build_master.py   # → data/master_*.csv               (wide + dept + category)
python3 build_school.py   # → data/school_functions.csv       (education by function)
python3 build_school_detail.py # → data/school_line_items.csv (education object-line detail)
python3 analyze.py        # → analysis/findings.txt           (exploration + scenarios)
```
`extracted/` holds the raw text dump of each PDF (via `pypdf`).

## Datasets (`data/`)
- **`line_items_long.csv`** — one row per (book, account, fiscal_year, measure).
  `measure` ∈ {budget, actual}; `section` ∈ {expenditure, revenue};
  `fund` ∈ {municipal, county}. The tidy source of truth for municipal detail.
- **`master_line_items.csv`** — one row per GL account, wide:
  `budget_2024..2027`, `actual_2023..2025`, plus `department`, `category`.
- **`master_by_department.csv`** / **`master_by_category.csv`** — roll-ups.
- **`summary_long.csv`** — headline General Fund / tax-rate metrics per year
  (appropriations, revenues, levy, tax base, rate).
- **`school_functions.csv`** — FY27 education split into ~20 functions
  (actuals FY23–25, budget FY26–27).
- **`school_line_items.csv`** — FY27 education at the **object-line level**
  (1,218 lines: program × building × object code), tagged with district
  `function` and `spend_category` (Salaries, Benefits, Supplies, …). Sums to the
  education grand total and reconciles to every function in `school_functions.csv`.

## Scope & granularity
- **Municipal** spending/revenue is parsed at the **GL line-item** level
  (≈340 expenditure + ≈30 revenue accounts).
- **Education** is a lump sum in the town books; the FY27 school PDF adds
  **function-level** detail (Regular Program, Special Ed, O&M, Transportation…).
  Prior-year school detail exists only as actuals, not approved budgets.
- **County tax** is a single assessed pass-through line (town can't set it).

## Validation (all pass to the dollar, ±$1–3 rounding)
The parser is checked against the budgets' own published control totals:
- Municipal expenditure total, each year → page-2 MUNICIPAL line. ✅
- Municipal revenue total → published "Total (Non-Educational)". ✅
- Six municipal **category** roll-ups → page-18 category totals. ✅
- Summary identities: Σ(muni+edu+county)=total expenses; expenses−revenues=levy;
  levy−reimbursements=net tax. ✅
- School function sum = GRAND TOTAL = $44,111,921.03 = published education. ✅
- School **object-line** detail (1,218 lines) sums to the grand total AND
  reconciles to all 20 function totals to the cent. ✅

### Parsing gotchas handled (see code comments)
- Column schema differs per book (some include Actuals); revenue schema differs
  from expenditure in the two older books; FY24-book revenue has no GL codes
  (recovered from the FY25 book instead).
- Page-6 expenditures lack a section header → classify by object code
  (4xxxx=revenue, 5xxxx=expenditure), not by header.
- Trailing two columns are always `$change`,`%change` — peeled from the right so
  a PDF-collapsed blank (oldest year) can't be mistaken for a value.
- Object codes are **not unique** within a department and drift across books →
  line-item identity includes the name; roll-ups sum all rows so totals are safe.

## Tax mechanics (FY27)
Tax base $3.221B, rate $15.25/$1,000, standard example home $500,000 → $7,625/yr.
**Conversion factor:** every **$1,000,000** cut from appropriations lowers the
rate **$0.31/$1,000** and the $500k home's bill **$155/year**.
⚠️ The FY25→FY26 rate drop ($25.67→$14.55) is a **revaluation** (base ~doubled),
not a cut — compare the **levy**, not the rate, across that boundary.

See `FINDINGS.md` for the narrative analysis and scenario table.
