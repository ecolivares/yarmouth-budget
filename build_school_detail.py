#!/usr/bin/env python3
"""Parse the FY27 school budget LEVEL-4 object-line detail (pages 2-44).

Each detail line is:  <program 6-digit> <object 3-4 digit> <name> <6 amounts> <pct>
The 6 amounts are: FY23 actual, FY24 actual, FY25 actual, FY26 actual (YTD),
FY26 budget, FY27 budget. Program-block header lines (code + name, no numbers)
set the current program; 'TOTAL <function>' lines (exact match to a page-1
district function) assign the function to the buffered detail rows.

Outputs data/school_line_items.csv and validates:
  - Σ object lines == GRAND TOTAL == $44,111,921.03 (published education)
  - per-function Σ == the page-1 function totals (school_functions.csv)
"""
import re, csv
from collections import defaultdict

SRC = "extracted/FY27 Full School Budget lvl 4.txt"
NUM = re.compile(r'-?[\d,]*\.\d{2}')
DETAIL = re.compile(r'^(\d{6})\s+(\d{3,4})\s+(.+)$')      # program, object, rest
HEADER = re.compile(r'^(\d{6})\s+([A-Za-z].*)$')          # program, name (no object)
COLS = ["fy23_actual", "fy24_actual", "fy25_actual",
        "fy26_actual", "fy26_budget", "fy27_budget"]

# Standard Maine school chart-of-accounts object ranges (by leading digit).
SPEND = {"1": "Salaries & Wages", "2": "Employee Benefits",
         "3": "Prof/Technical Services", "4": "Property Services",
         "5": "Other Purchased Services", "6": "Supplies",
         "7": "Property & Equipment", "8": "Other / Dues / Debt", "9": "Other"}


def amt(t):
    return float(t.replace(",", ""))


def main():
    functions = [r["function"] for r in csv.DictReader(open("data/school_functions.csv"))]
    fset = set(functions)

    rows = []
    buffer = []            # detail rows awaiting a function assignment
    cur_prog_code = cur_prog_name = None

    for line in open(SRC):
        s = line.rstrip("\n").strip()
        if not s:
            continue
        # function assignment: a 'TOTAL <fn>' exactly matching a district function
        if s.startswith("TOTAL "):
            label = re.sub(r'\s+-?[\d,]*\.\d{2}.*$', '', s[6:]).strip()
            if label in fset:
                for r in buffer:
                    r["function"] = label
                rows.extend(buffer)
                buffer = []
            continue
        if s.startswith("GRAND TOTAL"):
            continue
        m = DETAIL.match(s)
        if m and NUM.findall(m.group(3)):
            prog, obj, rest = m.groups()
            nums = NUM.findall(rest)
            if len(nums) != 6:        # malformed / wrapped line
                continue
            name = rest[:rest.index(nums[0])].strip()
            rec = {"program_code": prog, "program": cur_prog_name or "",
                   "object_code": obj, "object_name": name,
                   "spend_category": SPEND.get(obj[0], "Other"), "function": None}
            rec.update(dict(zip(COLS, [amt(n) for n in nums])))
            buffer.append(rec)
            continue
        h = HEADER.match(s)
        if h:
            cur_prog_code, cur_prog_name = h.group(1), h.group(2).strip()

    leftover = len(buffer)

    # ---- validation -------------------------------------------------------
    total = sum(r["fy27_budget"] for r in rows)
    print(f"{len(rows)} object lines parsed ({leftover} unassigned to a function)")
    print(f"FY27 Σ object lines = {total:,.2f}   vs published 44,111,921.03   "
          f"diff {total-44111921.03:+.2f}")
    assert leftover == 0, "some detail lines never matched a function total"
    assert abs(total - 44111921.03) < 1, "object-line sum != grand total"

    by_fn = defaultdict(float)
    for r in rows:
        by_fn[r["function"]] += r["fy27_budget"]
    page1 = {r["function"]: float(r["fy27_budget"])
             for r in csv.DictReader(open("data/school_functions.csv"))}
    print("\nper-function check (detail Σ vs page-1 rollup):")
    ok = True
    for fn in functions:
        d = by_fn[fn] - page1[fn]
        if abs(d) > 1: ok = False
        flag = "" if abs(d) < 1 else "  <-- MISMATCH"
        print(f"   {fn:<24} {by_fn[fn]:>14,.2f}  vs {page1[fn]:>14,.2f}  {d:+.2f}{flag}")
    print("ALL FUNCTIONS MATCH" if ok else "*** function mismatch ***")

    # ---- spend-type rollup (the headline new insight) ---------------------
    by_spend = defaultdict(float)
    for r in rows:
        by_spend[r["spend_category"]] += r["fy27_budget"]
    print("\nFY27 school budget by spend type:")
    for sc, v in sorted(by_spend.items(), key=lambda x: -x[1]):
        print(f"   {sc:<26} ${v:>13,.0f}   {v/total*100:5.1f}%")
    personnel = by_spend["Salaries & Wages"] + by_spend["Employee Benefits"]
    print(f"   {'-> Personnel (sal+benefits)':<26} ${personnel:>13,.0f}   {personnel/total*100:5.1f}%")

    with open("data/school_line_items.csv", "w", newline="") as fh:
        cols = ["function", "program_code", "program", "object_code",
                "object_name", "spend_category"] + COLS
        w = csv.DictWriter(fh, fieldnames=cols); w.writeheader()
        for r in sorted(rows, key=lambda r: -r["fy27_budget"]):
            w.writerow(r)
    print("\nWrote data/school_line_items.csv")


if __name__ == "__main__":
    main()
