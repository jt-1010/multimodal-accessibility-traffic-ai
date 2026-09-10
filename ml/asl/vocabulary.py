"""The ordering vocabulary, and where each sign's training data comes from.

Run this to regenerate the coverage report:

    python ml/asl/vocabulary.py

It answers one question: which signs must we record ourselves? Recording is
the expensive step -- it needs four people, several sessions, and produces
data from non-fluent signers -- so every sign we can source from a public
dataset is worth finding.

Inputs (both already downloaded):
  data/asl/sign_to_prediction_index_map.json   GISLR's 250 labels
  data/asl-lex/signdata.csv                    ASL-LEX 2.0, 2,719 glosses

ASL-LEX matters because ASL Citizen (83,399 videos, 52 signers) has 2,731
signs against ASL-LEX's 2,723 -- near-certainly the same vocabulary. Treat a
hit here as "very likely available in ASL Citizen", and confirm against ASL
Citizen's own label list once Microsoft grants access.
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GISLR_LABELS = ROOT / "data" / "asl" / "sign_to_prediction_index_map.json"
ASL_LEX = ROOT / "data" / "asl-lex" / "signdata.csv"

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


def load_asl_lex() -> dict[str, list[str]]:
    """Gloss -> its ASL-LEX entries.

    ASL-LEX marks regional/stylistic variants of the same sign as `name_1`,
    `name_2`. Strip the suffix so `shake` finds `shake_1`; the variants are
    all legitimate productions of the sign and all usable as training data.
    """
    # latin-1: the file contains a few non-UTF-8 bytes in the notes columns.
    with ASL_LEX.open(encoding="latin-1") as f:
        rows = list(csv.DictReader(f))

    by_base: dict[str, list[str]] = {}
    for r in rows:
        entry = (r.get("EntryID") or "").strip().lower()
        if entry:
            by_base.setdefault(re.sub(r"_\d+$", "", entry), []).append(entry)
    return by_base


def report() -> dict[str, list[str]]:
    gislr = load_gislr()
    lex = load_asl_lex()

    free, citizen, record = [], [], []
    for concept, candidates in ORDERING_VOCABULARY.items():
        if any(c in gislr for c in candidates):
            free.append(concept)
        elif any(c in lex for c in candidates):
            citizen.append(concept)
        else:
            record.append(concept)

    total = len(ORDERING_VOCABULARY)
    covered = len(free) + len(citizen)

    print(f"Ordering vocabulary: {total} concepts\n")
    print(f"[1] IN GISLR — data already downloaded ({len(free)})")
    print("    " + ", ".join(free) + "\n")
    print(f"[2] IN ASL-LEX, so very likely ASL Citizen — request access ({len(citizen)})")
    print("    " + ", ".join(citizen) + "\n")
    print(f"[3] MUST RECORD OURSELVES ({len(record)})")
    print("    " + (", ".join(record) if record else "(none)") + "\n")
    print(f"COVERAGE: {covered}/{total} = {100 * covered // total}% needs no recording")

    return {"gislr": free, "asl_citizen": citizen, "record": record}


if __name__ == "__main__":
    report()
