#!/usr/bin/env python3
"""Exploratory analysis + property-tax cut-scenario engine for Yarmouth ME.

Reads the validated master datasets and prints/writes a findings report.
All scenarios model: a $1 cut in appropriations -> $1 cut in the property-tax
levy (non-tax revenues held constant), converted to a rate change and to the
annual bill on the town's standard $500,000 example home.
"""
import csv
from collections import defaultdict

D = "data/"
FY = [2024, 2025, 2026, 2027]


def load(name):
    return list(csv.DictReader(open(D + name)))


def num(x):
    return float(x) if x not in ("", None) else 0.0


# ---- FY27 tax mechanics (from validated summary) --------------------------
TAX_BASE_FY27 = 3_221_025_900          # GF net taxable value
RATE_FY27 = 15.25                      # $ per $1,000 (04.09 draft book)
HOME = 500_000                         # town's standard example home
# $1 of levy cut -> this many $ off the rate per $1,000:
RATE_PER_DOLLAR = 1_000 / TAX_BASE_FY27
# ...and this many $ off the example home's annual bill:
HOME_PER_DOLLAR = HOME / TAX_BASE_FY27


def impact(cut):
    """Return (rate_drop_$/1000, annual_$ saved on the example home)."""
    return cut * RATE_PER_DOLLAR, cut * HOME_PER_DOLLAR


def main():
    cat = load("master_by_category.csv")
    summ = defaultdict(dict)
    for r in load("summary_long.csv"):
        summ[r["metric"]][int(r["fiscal_year"])] = num(r["amount"])
    school = load("school_functions.csv")
    items = load("master_line_items.csv")

    out = []
    def p(s=""):
        out.append(s); print(s)

    # ===== 1. WHERE THE MONEY GOES (FY27) =================================
    p("=" * 78)
    p("YARMOUTH, ME — BUDGET ANALYSIS  (FY2024–FY2027 draft)")
    p("=" * 78)
    muni = summ["municipal_appropriation"]
    edu  = summ["education_appropriation"]
    cty  = summ["county_tax"]
    tot  = summ["total_gf_expenses"]
    p("\n1. WHERE THE MONEY GOES — FY27 General Fund = ${:,.0f}".format(tot[2027]))
    for label, v in [("Education (schools)", edu[2027]),
                     ("Municipal (town)", muni[2027]),
                     ("Cumberland County tax", cty[2027])]:
        p(f"   {label:<24} ${v:>13,.0f}   {v/tot[2027]*100:5.1f}%")

    p("\n   Municipal $ {:,.0f} breaks down by function:".format(muni[2027]))
    crows = sorted(cat, key=lambda r: -num(r["budget_2027"]))
    for r in crows:
        v = num(r["budget_2027"])
        p(f"      {r['category']:<22} ${v:>12,.0f}   {v/muni[2027]*100:5.1f}% of muni"
          f"   {v/tot[2027]*100:4.1f}% of total")

    p("\n   Education $ {:,.0f} breaks down by function (top 10):".format(edu[2027]))
    for r in school[:10]:
        v = num(r["fy27_budget"])
        p(f"      {r['function']:<24} ${v:>12,.0f}   {v/edu[2027]*100:5.1f}% of school")

    # ===== 2. GROWTH 2024 -> 2027 ========================================
    p("\n" + "=" * 78)
    p("2. GROWTH — FY24 → FY27 (3-year change)")
    p("=" * 78)
    def grow(label, s):
        a, b = s[2024], s[2027]
        cagr = ((b / a) ** (1 / 3) - 1) * 100
        p(f"   {label:<24} ${a:>12,.0f} → ${b:>12,.0f}   "
          f"{(b-a)/a*100:+5.1f}%  (CAGR {cagr:+.1f}%/yr)  ${b-a:>+11,.0f}")
    grow("TOTAL General Fund", tot)
    grow("Education", edu)
    grow("Municipal", muni)
    grow("County tax", cty)
    grow("Net property tax levy", summ["net_gf_property_tax"])

    p("\n   Municipal categories, FY24 → FY27:")
    cmap = {r["category"]: r for r in cat}
    for c in sorted(cmap, key=lambda c: -(num(cmap[c]["budget_2027"]) - num(cmap[c]["budget_2024"]))):
        r = cmap[c]; a, b = num(r["budget_2024"]), num(r["budget_2027"])
        p(f"      {c:<22} ${a:>11,.0f} → ${b:>11,.0f}  {(b-a)/a*100:+6.1f}%  ${b-a:>+10,.0f}")

    # ===== 3. BIGGEST LINE-ITEM MOVERS (municipal) =======================
    p("\n" + "=" * 78)
    p("3. BIGGEST MUNICIPAL LINE-ITEM INCREASES, FY24 → FY27")
    p("=" * 78)
    exp = [r for r in items if r["section"] == "expenditure" and r["fund"] == "municipal"]
    for r in exp:
        r["_delta"] = num(r["budget_2027"]) - num(r["budget_2024"])
    for r in sorted(exp, key=lambda r: -r["_delta"])[:15]:
        a, b = num(r["budget_2024"]), num(r["budget_2027"])
        pct = (b - a) / a * 100 if a else float("nan")
        p(f"   {r['department']:<16} {r['name'][:30]:<30} ${a:>9,.0f}→${b:>9,.0f} ${r['_delta']:>+9,.0f}")

    # ===== 4. REVENUES ====================================================
    p("\n" + "=" * 78)
    p("4. REVENUE TRENDS (non-tax) — share of budget funded WITHOUT property tax")
    p("=" * 78)
    rev = summ["total_gf_revenues"]
    for fy in FY:
        p(f"   FY{fy}: non-tax revenue ${-rev[fy]:>12,.0f}   "
          f"property-tax levy ${summ['gf_property_tax_levy'][fy]:>12,.0f}   "
          f"({-rev[fy]/tot[fy]*100:.1f}% non-tax funded)")
    top_rev = sorted([r for r in items if r["section"] == "revenue"],
                     key=lambda r: -num(r["budget_2027"]))[:8]
    p("\n   Largest municipal non-tax revenue lines (FY27):")
    for r in top_rev:
        p(f"      {r['name'][:34]:<34} ${num(r['budget_2027']):>11,.0f}")

    # ===== 5. TAX MECHANICS ==============================================
    p("\n" + "=" * 78)
    p("5. PROPERTY-TAX MECHANICS (FY27)")
    p("=" * 78)
    p(f"   Net taxable value (tax base): ${TAX_BASE_FY27:,.0f}")
    p(f"   Tax rate: ${RATE_FY27:.2f} per $1,000")
    p(f"   Standard example home: ${HOME:,.0f}  →  annual tax ${HOME/1000*RATE_FY27:,.0f}")
    p(f"   *** CONVERSION FACTOR ***")
    p(f"   Every $1,000,000 cut from appropriations lowers:")
    rd, hd = impact(1_000_000)
    p(f"      • the tax rate by ${rd:.3f} per $1,000")
    p(f"      • the bill on a $500k home by ${hd:,.0f}/year")
    p(f"   NOTE: the FY25→FY26 rate drop ($25.67→$14.55) is a REVALUATION, not a")
    p(f"   cut — the tax base ~doubled. Compare the LEVY ($ raised), not the rate.")

    # ===== 6. CANNED CUT SCENARIOS =======================================
    p("\n" + "=" * 78)
    p("6. CANNED BUDGET-CUT SCENARIOS  (savings on the $500k example home)")
    p("=" * 78)
    athletics = next(num(r["fy27_budget"]) for r in school if "Athletics" in r["function"])
    capital = num(cmap["Capital Programs"]["budget_2027"])
    debt_capital = capital  # capital programs cat = debt + reserves
    # municipal operating = municipal minus capital programs (debt+reserves)
    muni_operating = muni[2027] - capital
    scenarios = [
        ("Flat-fund SCHOOLS at FY26 (0% vs +4.4%)", edu[2027] - edu[2026]),
        ("Flat-fund MUNICIPAL at FY26 (0% vs +4.1%)", muni[2027] - muni[2026]),
        ("Flat-fund SCHOOL+TOWN at FY26 (county is fixed)",
            (edu[2027]-edu[2026]) + (muni[2027]-muni[2026])),
        ("Hold TOTAL increase to 2.5% (inflation)", tot[2027] - tot[2026]*1.025),
        ("Eliminate school ATHLETICS entirely", athletics),
        ("Cut municipal CAPITAL RESERVES contribution 50%",
            _capital_reserves(items) * 0.5),
        ("5% across-the-board cut to MUNICIPAL OPERATING (excl. debt/capital)",
            muni_operating * 0.05),
        ("Eliminate the Community Services dept", _dept_total(items, "1570")),
        ("Double the Budgeted Use of Surplus (+$750k, ONE-TIME)", 750_000),
    ]
    p(f"   {'Scenario':<52}{'Cut $':>11}{'Rate':>8}{'$/home':>8}")
    p("   " + "-" * 76)
    for label, cut in scenarios:
        rd, hd = impact(cut)
        p(f"   {label:<52}{cut:>11,.0f}{-rd:>8.2f}{-hd:>8.0f}")
    p("\n   For reference, the FY27 budget as proposed ADDS about +$375/yr to the")
    p("   $500k home's bill. The biggest single 'easy' targets (athletics, a dept)")
    p("   each move the bill <$175/yr — real savings require touching schools,")
    p("   public safety, benefits, or capital, which are 85%+ of the budget.")

    with open("analysis/findings.txt", "w") as fh:
        fh.write("\n".join(out) + "\n")
    print("\n[written to analysis/findings.txt]")


def _dept_total(items, dept):
    return sum(num(r["budget_2027"]) for r in items if r["dept_code"] == dept
               and r["section"] == "expenditure")


def _capital_reserves(items):
    return sum(num(r["budget_2027"]) for r in items if r["dept_code"] == "1800")


if __name__ == "__main__":
    main()
