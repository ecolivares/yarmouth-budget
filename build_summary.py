#!/usr/bin/env python3
"""High-level General Fund / tax-rate summary, one value per fiscal year.

Values are taken from each book's page-2 "Tax Rate Calculation". Where a year
appears in multiple books we use the most recent book (final/restated figure).
The FY25->FY26 jump in tax base and drop in tax rate reflects a town-wide
statistical REVALUATION, not a real cut -- the levy ($ raised) is the
apples-to-apples comparison across the reval, not the rate ($/$1000).
"""
import csv

# metric -> {fy: amount}.  Expenses positive; revenues negative (as published).
SUMMARY = {
    "municipal_appropriation":      {2024: 16742702, 2025: 17968197, 2026: 18797126, 2027: 19561023},
    "education_appropriation":      {2024: 36590456, 2025: 39278131, 2026: 42248050, 2027: 44111921},
    "county_tax":                   {2024: 1525119,  2025: 1593135,  2026: 1680359,  2027: 1904994},
    "total_gf_expenses":            {2024: 54858277, 2025: 58839463, 2026: 62725535, 2027: 65577938},
    "municipal_revenues_balances":  {2024: -6391101, 2025: -6412801, 2026: -6664201, 2027: -6904801},
    "education_revenues_balances":  {2024: -8288258, 2025: -8681567, 2026: -9159786, 2027: -9192945},
    "total_gf_revenues":            {2024: -14679359,2025: -15094368,2026: -15823987,2027: -16097746},
    "gf_property_tax_levy":         {2024: 40178918, 2025: 43745095, 2026: 46901548, 2027: 49480192},
    "less_state_reimbursement_bh":  {2024: -878957,  2025: -764637,  2026: -688332,  2027: -718431},
    "net_gf_property_tax":          {2024: 39299961, 2025: 42980458, 2026: 46213215, 2027: 48761761},
    "gf_net_tax_base":              {2024: 1676323360, 2025: 1682138280, 2026: 3211136100, 2027: 3221025900},
    "tax_rate_per_1000":            {2024: 23.54, 2025: 25.67, 2026: 14.55, 2027: 15.25},
}

# Identity checks (must hold within rounding) -------------------------------
def check():
    S = SUMMARY
    for fy in (2024, 2025, 2026, 2027):
        exp = S["municipal_appropriation"][fy] + S["education_appropriation"][fy] + S["county_tax"][fy]
        assert abs(exp - S["total_gf_expenses"][fy]) < 2, (fy, "expense sum", exp)
        rev = S["municipal_revenues_balances"][fy] + S["education_revenues_balances"][fy]
        assert abs(rev - S["total_gf_revenues"][fy]) < 2, (fy, "rev sum", rev)
        levy = S["total_gf_expenses"][fy] + S["total_gf_revenues"][fy]  # revenues are negative
        assert abs(levy - S["gf_property_tax_levy"][fy]) < 2, (fy, "levy", levy, S["gf_property_tax_levy"][fy])
        net = S["gf_property_tax_levy"][fy] + S["less_state_reimbursement_bh"][fy]
        assert abs(net - S["net_gf_property_tax"][fy]) < 2, (fy, "net tax", net)
    print("All identity checks passed (expenses, revenues, levy, net tax).")


def main():
    check()
    with open("data/summary_long.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["metric", "fiscal_year", "amount"])
        for metric, series in SUMMARY.items():
            for fy in sorted(series):
                w.writerow([metric, fy, series[fy]])
    print("Wrote data/summary_long.csv")


if __name__ == "__main__":
    main()
