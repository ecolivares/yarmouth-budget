#!/usr/bin/env python3
"""Generate the embedded data bundles the web app ships with.

Reads the validated Phase-1 CSVs in data/ and emits two files that carry the
SAME numbers so the page and the chat evaluator never disagree:

  app/public/data.js       -> window.YB_DATA = {...}   (front-end rendering)
  app/api/_budget-data.js  -> export const BUDGET={...} (chat system prompt)

Run from the repo root:  python3 build_data.py
"""
import csv
import json
import os
import re

DATA = "data"
OUT_PUBLIC = "app/public/data.js"
OUT_API = "app/api/_budget-data.js"

# FY27 tax mechanics (from the draft "Citizens" book — see FINDINGS.md).
TAX_BASE_FY27 = 3_221_025_900
HOME = 500_000
YEARS = [2024, 2025, 2026, 2027]


def load(name):
    with open(os.path.join(DATA, name), newline="") as fh:
        return list(csv.DictReader(fh))


def num(x):
    if x in ("", None):
        return 0.0
    return float(x)


def build():
    # ---- headline summary metrics (summary_long.csv is metric/year/amount) ----
    summ = {}
    for r in load("summary_long.csv"):
        summ.setdefault(r["metric"], {})[int(r["fiscal_year"])] = num(r["amount"])

    def series(metric):
        return {str(y): summ.get(metric, {}).get(y) for y in YEARS}

    summary = {
        "years": YEARS,
        "education": series("education_appropriation"),
        "municipal": series("municipal_appropriation"),
        "county": series("county_tax"),
        "totalGF": series("total_gf_expenses"),
        "netLevy": series("net_gf_property_tax"),
        "taxBase": series("gf_net_tax_base"),
        "rate": series("tax_rate_per_1000"),
    }

    # ---- municipal categories (all four budget years) ----
    categories = []
    for r in load("master_by_category.csv"):
        categories.append({
            "name": r["category"],
            "fy24": num(r["budget_2024"]),
            "fy25": num(r["budget_2025"]),
            "fy26": num(r["budget_2026"]),
            "fy27": num(r["budget_2027"]),
        })
    categories.sort(key=lambda c: -c["fy27"])

    # ---- school functions (FY26 + FY27 budgets; prior years are actuals only) ----
    school = []
    for r in load("school_functions.csv"):
        school.append({
            "name": r["function"].strip(),
            "fy26": num(r["fy26_budget"]),
            "fy27": num(r["fy27_budget"]),
        })
    school.sort(key=lambda s: -s["fy27"])

    # ---- scenarios (enriched with side / target / impact for the UI) ----
    def classify_target(group, scen):
        s = scen.lower()
        if group == "Revenue":
            return "revenue"
        if group == "Compensation":
            return "both"          # town + school payrolls
        if "school" in s or "athletic" in s:
            return "schools"
        return "municipal"

    def impact_tier(home):
        h = abs(home)
        if h >= 100:
            return "high"
        if h >= 30:
            return "moderate"
        return "small"

    scenarios = []
    for r in load("scenarios.csv"):
        home = int(num(r["home_500k_impact"]))
        typ = r["type"]
        scenarios.append({
            "group": r["group"],
            "scenario": r["scenario"],
            "annual": int(num(r["annual_dollars"])),
            "type": typ,
            "side": "revenue" if typ == "revenue" else "cut",
            "target": classify_target(r["group"], r["scenario"]),
            "impact": impact_tier(home),
            "feasibility": r["feasibility"],
            "rate": float(r["rate_impact"]),
            "home": home,
            "note": r["note"],
        })

    # ---- mechanics / conversion factor ----
    rate_per_million = 1_000_000 * 1000 / TAX_BASE_FY27          # ~0.3105
    home_per_million = 1_000_000 * HOME / TAX_BASE_FY27          # ~155.2
    home_bill_fy27 = summary["rate"]["2027"] * HOME / 1000        # 7625

    mechanics = {
        "taxBaseFY27": TAX_BASE_FY27,
        "home": HOME,
        "rateFY27": summary["rate"]["2027"],
        "homeBillFY27": round(home_bill_fy27),
        "ratePerMillion": round(rate_per_million, 3),
        "homePerMillion": round(home_per_million),
    }

    # ---- "build your own cuts" — curated, NON-OVERLAPPING menu ----
    # Amounts are the validated scenario figures; each item is independent so the
    # running tally can't double-count. Sliders (staffing) are distinct pools.
    def home_of(dollars):
        return round(dollars * HOME / TAX_BASE_FY27)

    STAFF_PER_POSITION = 90_000  # ESTIMATE: avg all-in comp (salary+benefits). Labeled in UI.

    builder_opts = [
        # group: the small discretionary stuff people assume is "the waste"
        ("small", "Sustainability Coordinator", 95_465, False, "town-controlled",
         "Ends in-house climate/energy work; one staff position."),
        ("small", "Tree care / urban forestry", 74_000, False, "caution",
         "Defers hazard-tree removal; liability + canopy risk."),
        ("small", "STAY senior tax-relief reserve", 238_000, False, "verify",
         "This IS senior property-tax relief — cutting it hits the residents most squeezed by taxes."),
        ("small", "Metro regional transit subsidy", 131_547, False, "caution",
         "Ends regional bus access for residents who rely on it."),
        ("small", "Aging-in-Place program", 41_000, False, "town-controlled",
         "Cuts senior support services."),
        ("small", "Community Behavioral Health Liaison", 41_393, False, "town-controlled",
         "Removes the town's mental-health response role; one position."),
        ("small", "Conservation land maintenance", 28_000, False, "town-controlled",
         "Trail & open-space upkeep shifts to volunteers or lapses."),
        ("small", "Historical Society appropriation", 27_000, False, "town-controlled",
         "Ends a small heritage grant."),
        ("small", "GPCOG regional planning dues", 20_228, False, "caution",
         "Drops regional planning membership."),
        ("small", "Shellfish conservation", 7_000, False, "town-controlled",
         "Clam-flat management; may risk state license revenue."),
        ("small", "Human Service Agencies grants", 4_850, False, "town-controlled",
         "Zeroes grants to Opportunity Alliance, family-crisis & aging services."),
        ("small", "RRCT land-trust contribution", 4_500, False, "town-controlled",
         "Ends a conservation-partner contribution."),

        # group: amenities & services (bigger, more visible)
        ("amenity", "School athletics → pay-to-play", 719_891, False, "caution",
         "Families pay fees; Title IX + waivers cap recovery; some kids priced out.", "schools"),
        ("amenity", "School transportation — route optimization", 455_292, False, "constrained",
         "Longer/combined routes; SpEd + walk-zone mandates limit real savings.", "schools"),
        ("amenity", "Town library — reduce hours", 369_216, False, "caution",
         "Fewer open hours & staff; keeps the branch open."),
        ("amenity", "Parks & Rec — reduced maintenance", 378_732, False, "caution",
         "Fields & parks decline; some deed restrictions bar closure."),

        # group: pay & one-time levers
        ("lever", "Freeze cost-of-living raises (town + school, 1 yr)", 1_068_000, False, "bargained",
         "No COLA for teachers, police, fire & staff — requires union agreement.", "both"),
        ("lever", "Defer half of capital-reserve contributions", 909_360, True, "town-controlled",
         "Pushes equipment/building savings to later years — the cost returns."),
        ("lever", "Draw down more surplus (one-time)", 750_000, True, "town-controlled",
         "Spends one-time savings; can't repeat without rebuilding reserves."),
    ]

    builder = {
        "anchor": {
            "fy26Rate": summary["rate"]["2026"],
            "fy26Bill": round(summary["rate"]["2026"] * HOME / 1000),
            "fy27Rate": summary["rate"]["2027"],
            "fy27Bill": round(summary["rate"]["2027"] * HOME / 1000),
        },
        "options": [],
        "staffing": {
            "perPosition": STAFF_PER_POSITION,
            "note": "Assumes ~$" + format(STAFF_PER_POSITION, ",") + " average all-in cost per position "
                    "(salary + benefits) — an ESTIMATE; the dataset has payroll totals but not headcount.",
            "school": {"maxPositions": 40, "label": "Cut school staff (teachers, aides, specialists)",
                       "cost": "Larger class sizes; fewer teachers, aides, specialists, or programs."},
            "town": {"maxPositions": 15, "label": "Cut town staff (police, fire, public works)",
                     "cost": "Slower emergency response and thinner town services."},
        },
    }
    for opt in builder_opts:
        group, label, annual, one_time, feas, cost = opt[:6]
        target = opt[6] if len(opt) > 6 else "municipal"
        builder["options"].append({
            "id": re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-"),
            "group": group, "label": label, "annual": annual, "oneTime": one_time,
            "feasibility": feas, "cost": cost, "target": target,
            "home": home_of(annual),
        })
    builder["anchor"]["increase"] = builder["anchor"]["fy27Bill"] - builder["anchor"]["fy26Bill"]

    return {
        "meta": {
            "generated": "phase-1 dataset",
            "fyNote": "FY27 figures are from the 04.09 DRAFT 'Citizens' budget book.",
        },
        "summary": summary,
        "categories": categories,
        "school": school,
        "scenarios": scenarios,
        "mechanics": mechanics,
        "builder": builder,
    }


def main():
    bundle = build()
    payload = json.dumps(bundle, indent=2)

    os.makedirs(os.path.dirname(OUT_PUBLIC), exist_ok=True)
    os.makedirs(os.path.dirname(OUT_API), exist_ok=True)

    header = "// AUTO-GENERATED by build_data.py — do not edit by hand.\n"
    with open(OUT_PUBLIC, "w") as fh:
        fh.write(header)
        fh.write("window.YB_DATA = " + payload + ";\n")
    with open(OUT_API, "w") as fh:
        fh.write(header)
        fh.write("export const BUDGET = " + payload + ";\n")

    ed = bundle["summary"]["education"]["2027"]
    mu = bundle["summary"]["municipal"]["2027"]
    co = bundle["summary"]["county"]["2027"]
    tot = bundle["summary"]["totalGF"]["2027"]
    print(f"Wrote {OUT_PUBLIC} and {OUT_API}")
    print(f"FY27 GF ${tot:,.0f}  = edu ${ed:,.0f} ({ed/tot:.1%}) + "
          f"muni ${mu:,.0f} ({mu/tot:.1%}) + county ${co:,.0f} ({co/tot:.1%})")
    print(f"{len(bundle['scenarios'])} scenarios, {len(bundle['school'])} school functions, "
          f"{len(bundle['categories'])} muni categories")
    print(f"Conversion: $1M cut -> -${bundle['mechanics']['ratePerMillion']} rate -> "
          f"-${bundle['mechanics']['homePerMillion']}/home")


if __name__ == "__main__":
    main()
