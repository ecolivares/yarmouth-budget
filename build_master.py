#!/usr/bin/env python3
"""Assemble the master municipal dataset from the parsed long table.

Outputs (in data/):
  master_line_items.csv  - one row per GL account, wide budget/actual columns
  master_by_department.csv
  master_by_category.csv
Cross-checks department & category roll-ups against published category totals.
"""
import csv
from collections import defaultdict

DEPT = {
    "1100": ("Administration", "General Government"),
    "1110": ("Insurances", "General Government"),
    "1115": ("Benefits", "General Government"),
    "1120": ("Town Buildings", "General Government"),
    "1130": ("Town Buildings", "General Government"),
    "1200": ("Police", "Public Safety"),
    "1210": ("Fire-Rescue", "Public Safety"),
    "1220": ("Public Safety Building", "Public Safety"),
    "1240": ("Dispatch / PS Communications", "Public Safety"),
    "1260": ("Harbor & Water", "Public Safety"),
    "1270": ("Public Safety Misc.", "Public Safety"),
    "1310": ("Highways", "Public Works"),
    "1320": ("Solid Waste", "Public Works"),
    "1330": ("Wastewater", "Public Works"),
    "1340": ("Mechanical", "Public Works"),
    "1370": ("Trees", "Public Works"),
    "1400": ("General Assistance", "Health & Welfare"),
    "1410": ("Human Service Agencies", "Health & Welfare"),
    "1500": ("Library", "Public Services"),
    "1530": ("Parks & Recreation", "Public Services"),
    "1560": ("Cemeteries", "Public Services"),
    "1570": ("Community Services", "Public Services"),
    "1580": ("Planning & Development", "Public Services"),
    "1600": ("Debt Service", "Capital Programs"),
    "1800": ("Capital Reserves", "Capital Programs"),
    "1850": ("Cumberland County", "County"),
    "1000": ("Town Revenues", "Revenue"),
}

BUDGET_FYS = [2024, 2025, 2026, 2027]
ACTUAL_FYS = [2023, 2024, 2025]

# Published FY27 municipal category totals (page 18) for validation.
PUB_CAT_FY27 = {
    "General Government": 4954551, "Public Safety": 4525441,
    "Public Works": 4101724, "Health & Welfare": 105758,
    "Public Services": 2480603, "Capital Programs": 3392946,
}


def load():
    return list(csv.DictReader(open("data/line_items_long.csv")))


def pick(cells, fy, measure):
    """Authoritative value for (fy, measure): prefer the book whose target year
    is fy (the approving/proposing book), else the most recent book."""
    cands = [c for c in cells if int(c["fiscal_year"]) == fy and c["measure"] == measure
             and c["amount"] not in ("", None)]
    if not cands:
        return None
    cands.sort(key=lambda c: (int(c["book_fy"]) != fy, -int(c["book_fy"])))
    return float(cands[0]["amount"])


def main():
    rows = load()
    # Group by line-item identity. Object codes are NOT unique within a
    # department (e.g. 1580-52075 is both "Technology/Software" and "Transfer
    # to Technology Reserve") and even drift across books, so identity includes
    # the normalized name. Dept/category roll-ups sum all rows, so cross-year
    # name/code drift never affects totals -- only the wide line-item view.
    by_acct = defaultdict(list)
    for r in rows:
        ident = (r["section"], r["fund"], r["account"], r["name"].strip().lower())
        by_acct[ident].append(r)

    items = []
    for (section, fund, account, _nm), cells in by_acct.items():
        dept = cells[0]["dept_code"]
        name = max((c["name"] for c in cells), key=len)  # fullest name seen
        dname, cat = DEPT.get(dept, ("Unknown", "Unknown"))
        if section == "revenue":
            cat = "Revenue"
        rec = {
            "section": section, "fund": fund, "account": account,
            "dept_code": dept, "department": dname, "category": cat, "name": name,
        }
        for fy in BUDGET_FYS:
            rec[f"budget_{fy}"] = pick(cells, fy, "budget")
        for fy in ACTUAL_FYS:
            rec[f"actual_{fy}"] = pick(cells, fy, "actual")
        items.append(rec)

    cols = (["section", "fund", "account", "dept_code", "department", "category", "name"]
            + [f"budget_{fy}" for fy in BUDGET_FYS] + [f"actual_{fy}" for fy in ACTUAL_FYS])
    with open("data/master_line_items.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols); w.writeheader()
        for it in items:
            w.writerow({k: ("" if it.get(k) is None else it.get(k)) for k in cols})

    # Department roll-up (expenditure, municipal)
    dep = defaultdict(lambda: defaultdict(float))
    for it in items:
        if it["section"] == "expenditure" and it["fund"] == "municipal":
            for fy in BUDGET_FYS:
                v = it.get(f"budget_{fy}")
                if v is not None:
                    dep[(it["dept_code"], it["department"], it["category"])][fy] += v
    with open("data/master_by_department.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["dept_code", "department", "category"] + [f"budget_{fy}" for fy in BUDGET_FYS])
        for (dc, dn, cat), s in sorted(dep.items()):
            w.writerow([dc, dn, cat] + [round(s.get(fy, 0)) for fy in BUDGET_FYS])

    # Category roll-up + validation
    cat = defaultdict(lambda: defaultdict(float))
    for (dc, dn, c), s in dep.items():
        for fy in BUDGET_FYS:
            cat[c][fy] += s.get(fy, 0)
    with open("data/master_by_category.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["category"] + [f"budget_{fy}" for fy in BUDGET_FYS])
        for c, s in sorted(cat.items()):
            w.writerow([c] + [round(s.get(fy, 0)) for fy in BUDGET_FYS])

    print(f"Wrote master: {len(items)} accounts "
          f"({sum(1 for i in items if i['section']=='expenditure')} exp, "
          f"{sum(1 for i in items if i['section']=='revenue')} rev)\n")
    print("FY27 category validation vs published page-18 totals:")
    ok = True
    for c, pub in PUB_CAT_FY27.items():
        got = round(cat[c][2027]); d = got - pub
        if abs(d) > 3: ok = False
        print(f"  {c:<20} parsed {got:>12,}  pub {pub:>12,}  diff {d:>+6,}")
    print("  ALL OK" if ok else "  *** MISMATCH ***")


if __name__ == "__main__":
    main()
