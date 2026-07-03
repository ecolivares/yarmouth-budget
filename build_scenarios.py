#!/usr/bin/env python3
"""Consolidated budget-cut / revenue scenario engine for Yarmouth ME.

Pulls real line-item amounts from the master datasets, attaches each scenario a
feasibility flag and note, converts every dollar to a tax-rate and a $500k-home
impact, and writes data/scenarios.csv + prints grouped summary tables.

Model: $1 of cut OR new revenue reduces the property-tax levy $1 (non-tax
revenue and the tax base held constant). Conversion at the FY27 tax base.
"""
import csv
from collections import defaultdict

TAX_BASE = 3_221_025_900
HOME = 500_000
def rate(d): return d * 1000 / TAX_BASE
def home(d): return d * HOME / TAX_BASE


def load(name):
    return list(csv.DictReader(open("data/" + name)))


def n(x):
    return float(x) if x not in ("", None) else 0.0


def main():
    muni = [r for r in load("master_line_items.csv")
            if r["section"] == "expenditure" and r["fund"] == "municipal"]
    sch = load("school_line_items.csv")
    sfun = {r["function"]: n(r["fy27_budget"]) for r in load("school_functions.csv")}

    def m(name_contains, dept=None):
        """FY27 budget of municipal lines matching name (and optional dept)."""
        return sum(n(r["budget_2027"]) for r in muni
                   if name_contains.lower() in r["name"].lower()
                   and (dept is None or r["dept_code"] == dept))

    def dept(code):
        return sum(n(r["budget_2027"]) for r in muni if r["dept_code"] == code)

    # ---- scenario definitions: (group, label, $, type, feasibility, note) --
    S = []
    A = S.append

    # --- MUNICIPAL: climate / conservation / sustainability ---
    A(("Muni · Climate/Conservation", "Eliminate Sustainability Coordinator (position)",
       m("Sustainability"), "cut", "town-controlled",
       "Cuts a staff position; ends in-house climate/energy work"))
    A(("Muni · Climate/Conservation", "Cut Conservation Land Maintenance",
       m("Conservation Land"), "cut", "town-controlled",
       "Defer/volunteer-shift trail & open-space upkeep"))
    A(("Muni · Climate/Conservation", "Cut Shellfish Conservation",
       m("Shellfish"), "cut", "town-controlled",
       "Clam-flat mgmt; may have state license-revenue tie"))
    A(("Muni · Climate/Conservation", "End RRCT (Royal River Conservation Trust) subsidy",
       m("RRCT"), "cut", "town-controlled", "Discretionary partner contribution"))
    A(("Muni · Climate/Conservation", "Cut Tree Care / urban forestry",
       dept("1370"), "cut", "caution",
       "Liability + canopy/property-value risk; deferral safer than elimination"))

    # --- MUNICIPAL: STAY + senior / social services ---
    A(("Muni · Senior/Social", "Eliminate STAY Program reserve",
       m("STAY"), "cut", "VERIFY / self-defeating?",
       "Appears to be senior tax-relief/aging support — cutting it hurts the "
       "residents most squeezed by property tax. Confirm purpose before listing"))
    A(("Muni · Senior/Social", "Cut Aging In Place program",
       m("Aging In Place"), "cut", "town-controlled", "Senior services"))
    A(("Muni · Senior/Social", "Eliminate Community Behavioral Health Liaison (position)",
       m("Behavioral Health"), "cut", "town-controlled", "New social-services position"))
    A(("Muni · Senior/Social", "End Metro regional transit subsidy",
       m("Metro Subsidy"), "cut", "caution",
       "Regional bus service; equity/access + possible regional-compact obligation"))
    A(("Muni · Senior/Social", "End Historical Society appropriation",
       m("Historical Society"), "cut", "town-controlled", "Discretionary grant"))
    A(("Muni · Senior/Social", "Zero out Human Service Agencies (1410)",
       dept("1410"), "cut", "town-controlled",
       "Opportunity Alliance, Family Crisis Center, Area Agency on Aging, etc."))
    A(("Muni · Senior/Social", "Cut GPCOG / regional planning dues",
       m("GPCOG"), "cut", "caution", "Regional planning council membership"))

    # --- MUNICIPAL: capital-reserve discretionary (defer) ---
    A(("Muni · Capital defer", "Defer Parks & Playgrounds reserve",
       m("Parks and Playgrounds"), "one-time", "town-controlled", "One-year deferral"))
    A(("Muni · Capital defer", "Defer Library Building reserve",
       m("Library Building"), "one-time", "town-controlled", "One-year deferral"))
    A(("Muni · Capital defer", "Cut municipal CAPITAL RESERVES contribution 50%",
       dept("1800") * 0.5, "one-time", "town-controlled",
       "Broad one-year deferral of capital set-asides"))

    # --- MUNICIPAL: broad operating / department ---
    A(("Muni · Broad", "Eliminate the Community Services dept (1570) entirely",
       dept("1570"), "cut", "aggressive",
       "Wipes climate+senior+regional+historical+shellfish at once"))
    A(("Muni · Broad", "5% across-the-board cut to municipal OPERATING (excl debt/capital)",
       (dept("1600") * 0 + (sum(n(r["budget_2027"]) for r in muni)
        - dept("1600") - dept("1800"))) * 0.05, "cut", "town-controlled",
       "Operating = municipal minus debt & capital"))

    # --- the earlier 'amenity' deep cuts, for context ---
    A(("Amenities (named)", "Town library — hours/consolidate (not eliminate)",
       dept("1500") * 0.5, "cut", "caution", "Full elimination forfeits MaineCat/ILL + property value"))
    A(("Amenities (named)", "Parks & Rec — reduced maintenance / Friends model",
       dept("1530") * 0.5, "cut", "caution", "Deed restrictions (LWCF) bar full closure of some parks"))
    A(("Amenities (named)", "School athletics — pay-to-play (realistic recovery)",
       sfun["Extra Curr Athletics"] * 0.65, "cut", "caution",
       "Title IX + fee waivers cap recovery ~65%"))
    A(("Amenities (named)", "School transportation — route optimization (not elimination)",
       sfun["Student Transportation"] * 0.25, "cut", "constrained",
       "SpEd/walk-zone mandates + EPS state-aid clawback limit net savings"))

    # --- compensation + revenue anchors (from prior rounds) ---
    A(("Compensation", "0% COLA vs 3% step, town+school (1 yr, negotiated)",
       1_068_000, "cut", "bargained", "~$356k per 1% across both payrolls; no service loss"))
    A(("Revenue", "Waterfront recapture (mooring/commercial fees + reassessment + excise audit)",
       450_000, "revenue", "study needed", "Mid of $300-600k range; boats themselves are excise-capped"))
    A(("Revenue", "NYA non-exempt-use audit + service charges / PILOT",
       250_000, "revenue", "negotiated/legal", "Mid of $100-400k; cannot force exemption removal"))
    A(("Revenue", "Fee/cost-recovery (rescue billing + STR fees + stormwater utility)",
       400_000, "revenue", "town-controlled", "Mid of $250-650k range"))

    # ---- write CSV --------------------------------------------------------
    rows = []
    for grp, label, amt, typ, feas, note in S:
        rows.append({"group": grp, "scenario": label, "annual_dollars": round(amt),
                     "type": typ, "feasibility": feas,
                     "rate_impact": round(rate(amt), 3),
                     "home_500k_impact": round(home(amt)), "note": note})
    with open("data/scenarios.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)

    # ---- print grouped tables --------------------------------------------
    groups = defaultdict(list)
    for r in rows:
        groups[r["group"]].append(r)
    for g in ["Muni · Climate/Conservation", "Muni · Senior/Social",
              "Muni · Capital defer", "Muni · Broad", "Amenities (named)",
              "Compensation", "Revenue"]:
        print(f"\n=== {g} ===")
        sub = sorted(groups[g], key=lambda r: -r["annual_dollars"])
        for r in sub:
            print(f"  {r['scenario'][:54]:<54} ${r['annual_dollars']:>8,}"
                  f"  -${-0+r['rate_impact']:.2f}  -${r['home_500k_impact']:>3}/home"
                  f"   [{r['feasibility']}]")

    # municipal discretionary maximal bundle (climate+social+historical, no capital/ops dup)
    disc = sum(r["annual_dollars"] for r in rows
               if r["group"] in ("Muni · Climate/Conservation", "Muni · Senior/Social")
               and "Tree" not in r["scenario"] and "Metro" not in r["scenario"]
               and "STAY" not in r["scenario"])
    print(f"\nMUNI DISCRETIONARY 'values' bundle (excl tree/metro/STAY): "
          f"${disc:,.0f}  -${rate(disc):.2f} rate  -${home(disc):.0f}/home/yr")
    print("Wrote data/scenarios.csv")


if __name__ == "__main__":
    main()
