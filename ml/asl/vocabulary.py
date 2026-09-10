"""The ordering vocabulary, and where each sign's training data comes from.

Run this to regenerate the coverage report:

    python ml/asl/vocabulary.py

It answers one question: which signs must we record ourselves? Recording is
the expensive step -- it needs four people, several sessions, and produces
data from non-fluent signers -- so every sign we can source from a public
dataset is worth finding.

Sources, in order of preference:
  data/asl/sign_to_prediction_index_map.json      GISLR's 250 labels
  $ASL_CITIZEN_ROOT/splits/*.csv                  ASL Citizen's real 2,731
  data/asl-lex/signdata.csv                       ASL-LEX 2.0, as a fallback

ASL Citizen is used directly when downloaded -- it is the corpus we train on,
and its CSVs give a clip count per sign. ASL-LEX stands in when it is not:
ASL Citizen's own splits carry an `ASL-LEX Code` column, so the two share a
vocabulary and the proxy is a good one.
"""

from __future__ import annotations

import csv
import json
import os
import pathlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GISLR_LABELS = ROOT / "data" / "asl" / "sign_to_prediction_index_map.json"
ASL_LEX = ROOT / "data" / "asl-lex" / "signdata.csv"

# ASL Citizen is 46GB and lives outside the repo. Point at it with:
#   set ASL_CITIZEN_ROOT=<path to the unzipped ASL_Citizen folder>
ASL_CITIZEN_ROOT = pathlib.Path(
    os.environ.get("ASL_CITIZEN_ROOT", ROOT / "data" / "asl-citizen" / "ASL_Citizen")
)

# Concept -> candidate glosses. Multiple candidates because datasets disagree
# on naming: BURGER is "hamburger" in ASL-LEX, LARGE is "big".
ORDERING_VOCABULARY: dict[str, list[str]] = {
    # --- food ---
    "BURGER": ["hamburger"],
    "FRIES": ["frenchfries", "fry"],
    "CHICKEN": ["chicken"],
    "NUGGET": ["nugget"],
    "SANDWICH": ["sandwich"],
    "SALAD": ["salad"],
    "PIZZA": ["pizza"],
    "HOTDOG": ["hotdog"],
    "FISH": ["fish"],
    "EGG": ["egg"],
    "BREAD": ["bread"],
    "CHEESE": ["cheese"],
    "COOKIE": ["cookie"],
    "ICE CREAM": ["icecream"],
    "MILKSHAKE": ["shake"],
    # --- drinks ---
    "COFFEE": ["coffee"],
    "SODA": ["soda", "pop"],
    "WATER": ["water"],
    "MILK": ["milk"],
    "JUICE": ["juice"],
    "DRINK": ["drink"],
    # --- accompaniments ---
    "CUP": ["cup"],
    "STRAW": ["straw"],
    "NAPKIN": ["napkin"],
    "BAG": ["bag"],
    "SAUCE": ["sauce"],
    "SALT": ["salt"],
    # --- descriptors ---
    "SWEET": ["sweet"],
    "SPICY": ["spicy"],
    "HOT": ["hot"],
    "COLD": ["cold"],
    "LARGE": ["big", "large"],
    "MEDIUM": ["middle"],
    "SMALL": ["small", "little"],
    # --- transaction ---
    "MORE": ["more"],
    "WANT": ["want"],
    "EAT": ["eat"],
    "HUNGRY": ["hungry"],
    "ORDER": ["order"],
    "MEAL": ["lunch", "dinner", "breakfast"],
    "PAY": ["pay", "money"],
    "CHANGE": ["change"],
    "READY": ["ready"],
    "HELP": ["help"],
    "PLEASE": ["please"],
    "THANK YOU": ["thankyou"],
    "YES": ["yes"],
    "NO": ["no"],
    "FINISH": ["finish"],
    "WAIT": ["wait"],
    "HOW MANY": ["many", "how"],
    "RESTAURANT": ["restaurant"],
    # --- quantities ---
    **{
        f"NUMBER {n.upper()}": [n]
        for n in "one two three four five six seven eight nine ten".split()
    },
}


def load_gislr() -> set[str]:
    with GISLR_LABELS.open(encoding="utf-8") as f:
        return set(json.load(f).keys())


#: Corpora disagree on how they mark variants of the same sign: ASL-LEX writes
#: `shake_1`, ASL Citizen writes `shake1`. Both denote the same sign produced a
#: different way, and every variant is legitimate training data -- so strip
#: either form. Handling only the underscore version produced a false reading
#: that twelve signs were missing from ASL Citizen. The real number was four.
VARIANT_SUFFIX = re.compile(r"_?\d+$")


def _index(glosses) -> dict[str, list[str]]:
    """base gloss -> the distinct variants of it present in the corpus."""
    by_base: dict[str, set[str]] = {}
    for g in glosses:
        g = (g or "").strip().lower()
        if g:
            by_base.setdefault(VARIANT_SUFFIX.sub("", g), set()).add(g)
    return {base: sorted(variants) for base, variants in by_base.items()}


def load_asl_lex() -> dict[str, list[str]]:
    """ASL-LEX 2.0 glosses. Used as a proxy when ASL Citizen is not present."""
    if not ASL_LEX.exists():
        return {}
    # latin-1: the file has a few non-UTF-8 bytes in the notes columns.
    with ASL_LEX.open(encoding="latin-1") as f:
        return _index(r.get("EntryID") for r in csv.DictReader(f))


def load_asl_citizen() -> tuple[dict[str, list[str]], dict[str, int]]:
    """The real ASL Citizen glosses, with a clip count for each.

    Preferred over the ASL-LEX proxy once downloaded: this is the corpus we
    actually train on, and it tells us how many clips each sign really has.
    """
    splits = ASL_CITIZEN_ROOT / "splits"
    if not splits.exists():
        return {}, {}

    glosses: list[str] = []
    for name in ("train.csv", "val.csv", "test.csv"):
        path = splits / name
        if not path.exists():
            continue
        with path.open(encoding="utf-8-sig") as f:
            glosses.extend(r["Gloss"] for r in csv.DictReader(f) if r.get("Gloss"))

    counts: dict[str, int] = {}
    for g in glosses:
        key = g.strip().lower()
        counts[key] = counts.get(key, 0) + 1
    return _index(glosses), counts


def report() -> dict[str, list[str]]:
    gislr = load_gislr()
    citizen_index, citizen_counts = load_asl_citizen()
    using_real = bool(citizen_index)
    lookup = citizen_index or load_asl_lex()

    print(
        "Second source: "
        + ("ASL Citizen (downloaded)" if using_real else "ASL-LEX 2.0 (proxy)")
        + "\n"
    )

    free, citizen, record = [], [], []
    for concept, candidates in ORDERING_VOCABULARY.items():
        if any(c in gislr for c in candidates):
            free.append(concept)
            continue
        hit = next((c for c in candidates if c in lookup), None)
        if hit:
            variants = lookup[hit]
            clips = sum(citizen_counts.get(v, 0) for v in variants)
            label = f"{concept} -> {'/'.join(variants)}"
            citizen.append(label + (f"  ({clips} clips)" if clips else ""))
        else:
            record.append(concept)

    total = len(ORDERING_VOCABULARY)
    covered = len(free) + len(citizen)

    print(f"Ordering vocabulary: {total} concepts\n")
    print(f"[1] IN GISLR — already downloaded ({len(free)})")
    print("    " + ", ".join(free) + "\n")
    print(f"[2] IN {'ASL CITIZEN' if using_real else 'ASL-LEX'} ({len(citizen)})")
    for line in citizen:
        print("    " + line)
    print()
    print(f"[3] MUST RECORD OURSELVES ({len(record)})")
    print("    " + (", ".join(record) if record else "(none)") + "\n")
    print(f"COVERAGE: {covered}/{total} = {100 * covered // total}% needs no recording")

    return {"gislr": free, "asl_citizen": citizen, "record": record}


if __name__ == "__main__":
    report()
