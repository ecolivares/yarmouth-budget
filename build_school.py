#!/usr/bin/env python3
"""Parse the district-wide function summary from the FY27 Full School Budget.

Source columns (per the report header):
  PRIOR FY3 ACTUALS = FY23 actual   PRIOR FY2 ACTUALS = FY24 actual
  LAST FY1 ACTUALS  = FY25 actual   CY ACTUALS        = FY26 actual (YTD)
  CY REV BUDGET     = FY26 budget   PROJECTION LEVEL4 = FY27 budget
Only the district roll-up (page 1, the 'TOTAL <function>' lines down to GRAND
TOTAL) is used; deeper pages repeat this split per school building.
"""
import re, csv

SRC = "extracted/FY27 Full School Budget lvl 4.txt"
NUM = re.compile(r'-?[\d,]*\.\d{2}')   # also matches bare '.00' (zero cells)
COLS = ["fy23_actual", "fy24_actual", "fy25_actual",
        "fy26_actual", "fy26_budget", "fy27_budget"]


def parse_amt(t):
    return float(t.replace(",", ""))


def main():
    rows = []
    grand = None
    started = False
    for line in open(SRC):
        s = line.strip()
        if s.startswith("TOTAL ") or s.startswith("GRAND TOTAL"):
            nums = NUM.findall(s)
            if len(nums) != 6:
                continue
            name = s[:s.index(nums[0])].replace("TOTAL", "").strip()
            vals = [parse_amt(n) for n in nums]
            rec = {"function": name if name else "GRAND TOTAL"}
            rec.update(dict(zip(COLS, vals)))
            if s.startswith("GRAND TOTAL"):
                grand = rec
                break              # page-1 district summary ends at GRAND TOTAL
            rows.append(rec)
            started = True
        elif started and not s:
            continue

    total = sum(r["fy27_budget"] for r in rows)
    print(f"{len(rows)} functions, FY27 sum = {total:,.2f}  "
          f"grand total = {grand['fy27_budget']:,.2f}  "
          f"diff {total - grand['fy27_budget']:+.2f}")
    assert abs(total - grand["fy27_budget"]) < 1, "function sum != grand total"
    assert abs(grand["fy27_budget"] - 44111921.03) < 1, "grand total != published education"
    print("Validated: function sum == GRAND TOTAL == published education appropriation.")

    with open("data/school_functions.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["function"] + COLS)
        w.writeheader()
        rows.sort(key=lambda r: -r["fy27_budget"])
        for r in rows:
            w.writerow(r)
    print("Wrote data/school_functions.csv")


if __name__ == "__main__":
    main()
