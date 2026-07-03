#!/usr/bin/env python3
"""Parse Yarmouth, ME town budget PDFs into a tidy long-format dataset.

Each annual "book" details MUNICIPAL revenues & expenditures at the GL
line-item level. Education and County appear only as lump sums on the
summary/tax pages. The column layout differs per book, so each book has an
explicit schema mapping value-column position -> (fiscal_year, measure).
"""
import re, csv, glob, os
import pypdf

EXTRACT_DIR = "extracted"
DATA_DIR = "data"

# Per-book schema: ordered list of (fiscal_year, measure) for the value
# columns that precede the two trailing change columns ($ change, % change).
# fiscal_year = the year the budget *ends* (FY24 = July2023-June2024).
# exp = expenditure column schema; rev = revenue column schema (differs in the
# two older books). FY24-book revenue lines carry no GL codes, so we skip them
# (FY24 revenue is recovered from the FY25 book, which lists it as a column).
BOOKS = {
    "FY24 Town & School Budget as approved at TM 06.06.23": {
        "book_fy": 2024,
        "exp": [(2021, "budget"), (2022, "budget"), (2023, "budget"), (2024, "budget")],
        "rev": None,
    },
    "2024-2025 Town & School Budget approved at TM 06.04.24": {
        "book_fy": 2025,
        "exp": [(2022, "budget"), (2023, "budget"), (2023, "actual"),
                (2024, "budget"), (2025, "budget")],
        "rev": [(2023, "budget"), (2024, "budget"), (2025, "budget")],
    },
    "2025-2026 Town  School Budget as approved at TM 06.10.25": {
        "book_fy": 2026,
        "exp": [(2024, "budget"), (2024, "actual"), (2025, "budget"), (2026, "budget")],
        "rev": [(2024, "budget"), (2024, "actual"), (2025, "budget"), (2026, "budget")],
    },
    "2026-2027 DRAFT Town  School Budget_04.09.26 Citizens 05.04.26": {
        "book_fy": 2027,
        "exp": [(2025, "budget"), (2025, "actual"), (2026, "budget"), (2027, "budget")],
        "rev": [(2025, "budget"), (2025, "actual"), (2026, "budget"), (2027, "budget")],
    },
}

# A numeric/amount token: optional paren (negative), optional $, digits/commas,
# optional decimals, optional %, optional close paren. Also bare '-', '#DIV/0!'.
AMT = re.compile(r'^\(?-?\$?[\d,]+(?:\.\d+)?\)?%?$|^-$|^#DIV/0!$|^\$$|^\(?[\d.]+%\)?$')
GL_FULL = re.compile(r'^(\d{4})\s+(\d{5})\s+(.*)$')   # dept + object + name
GL_OBJ  = re.compile(r'^(\d{5})\s+(.*)$')              # object only (dept implied)
GL_DEPT = re.compile(r'^(\d{4})\s+([A-Za-z].*)$')     # dept + name, no object code


def to_num(tok):
    """Convert an amount token to float; dash/blank -> None."""
    tok = tok.strip()
    if tok in ('-', '', '$', '#DIV/0!'):
        return None
    neg = tok.startswith('(') and tok.endswith(')')
    tok = tok.strip('()').replace('$', '').replace(',', '').rstrip('%')
    if tok in ('-', ''):
        return None
    try:
        v = float(tok)
    except ValueError:
        return None
    return -v if neg else v


def split_name_amounts(rest):
    """Given text after the GL code, return (name, [amount_tokens])."""
    toks = rest.split()
    i = len(toks)
    while i > 0 and AMT.match(toks[i - 1]):
        i -= 1
    name = ' '.join(toks[:i]).strip()
    amts = toks[i:]
    return name, amts


def parse_book(txt_path, schema):
    rows = []
    skipped = []
    cur_dept = None
    for raw in open(txt_path):
        line = raw.rstrip('\n')
        s = line.strip()
        if not s:
            continue
        # capture GL line items only
        m = GL_FULL.match(s)
        if m:
            cur_dept = m.group(1)
            obj = m.group(2); rest = m.group(3)
        else:
            m2 = GL_OBJ.match(s)
            if m2:
                obj = m2.group(1); rest = m2.group(2)
            else:
                # Dept-coded line item with no object code (e.g. FMLA). Only
                # accept when the dept matches the section we're already in, to
                # avoid catching stray year-labeled summary rows.
                m3 = GL_DEPT.match(s)
                if not m3 or m3.group(1) != cur_dept:
                    continue
                obj = ''; rest = m3.group(2)
        dept = cur_dept
        # Classify by object code: 4xxxx = revenue, 5xxxx = expenditure.
        # Object-less dept lines are expenditures (benefits etc.).
        section = 'revenue' if obj[:1] == '4' else 'expenditure'
        cols = schema["rev"] if section == 'revenue' else schema["exp"]
        if cols is None:
            continue
        ncols = len(cols)
        # Fund: dept 1850 is Cumberland County tax (passed through, not municipal).
        fund = 'county' if dept == '1850' else 'municipal'
        name, amts = split_name_amounts(rest)
        # Trailing layout is always [value...] [change$] [change%]. The %change
        # reliably ends in '%' or is '#DIV/0!', so peel the two change columns
        # off the RIGHT first -- this avoids mistaking a change column for a
        # value when the PDF collapsed a blank (oldest-year) cell.
        if amts and (amts[-1].endswith('%') or amts[-1] == '#DIV/0!'):
            values = amts[:-2]
        else:
            values = amts
        if not values:
            skipped.append((obj, name, amts)); continue
        # Right-align: collapsed blanks are oldest years, so values map to the
        # most-recent columns. (If somehow over-long, keep the most recent.)
        if len(values) < ncols:
            vals = [None] * (ncols - len(values)) + values
        else:
            vals = values[-ncols:]
        for (fy, measure), tok in zip(cols, vals):
            if tok is None:
                continue
            v = to_num(tok)
            rows.append({
                "book_fy": schema["book_fy"],
                "section": section,
                "fund": fund,
                "dept_code": dept,
                "object_code": obj,
                "account": (f"{dept}-{obj}" if obj else
                            f"{dept}-{name[:20]}" if dept else name),
                "name": name,
                "fiscal_year": fy,
                "measure": measure,
                "amount": v,
            })
    return rows, skipped


def main():
    all_rows = []
    for stem, schema in BOOKS.items():
        path = os.path.join(EXTRACT_DIR, stem + ".txt")
        rows, skipped = parse_book(path, schema)
        nitems = len({(r['account'], r['fiscal_year'], r['measure']) for r in rows})
        print(f"{schema['book_fy']}: {len(rows)} value-rows, {nitems} item-cells, "
              f"{len(skipped)} skipped  <- {stem[:40]}")
        for obj, name, amts in skipped[:8]:
            print(f"    SKIP {obj} {name!r} amts={amts}")
        all_rows.extend(rows)
    os.makedirs(DATA_DIR, exist_ok=True)
    out = os.path.join(DATA_DIR, "line_items_long.csv")
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(all_rows[0].keys()))
        w.writeheader(); w.writerows(all_rows)
    print(f"\nWrote {len(all_rows)} rows -> {out}")


if __name__ == "__main__":
    main()
