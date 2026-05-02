#!/usr/bin/env python3
"""
Format anonymized + labeled memories into training-ready datasets.

Produces two output files:
1. sivu_training.jsonl — for SI Value Unit (quality gate: store/reject)
2. sicu_training.jsonl — for SI Classification Unit (memory type classifier)

Each record contains:
- text: the memory content
- label: the target label

Usage:
    python format_training_data.py --input anonymized_memories.jsonl
"""

import argparse
import json
import sys
import random
from collections import defaultdict


def main():
    parser = argparse.ArgumentParser(description="Format training data for SIU models")
    parser.add_argument("--input", required=True, help="Input anonymized+labeled JSONL")
    parser.add_argument("--sivu-output", default="sivu_training.jsonl", help="SIVU output")
    parser.add_argument("--sicu-output", default="sicu_training.jsonl", help="SICU output")
    parser.add_argument("--test-split", type=float, default=0.2, help="Fraction for test set")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    random.seed(args.seed)

    records = []
    with open(args.input) as f:
        for line in f:
            if line.strip():
                records.append(json.loads(line))

    # Shuffle
    random.shuffle(records)

    # ── SIVU: Store vs Reject ──
    sivu_data = []
    for rec in records:
        text = rec["content"].strip()
        if not text:
            continue
        sivu_data.append({
            "text": text,
            "label": rec["quality"],  # "store" or "reject"
            "reason": rec.get("quality_reason", ""),
            "confidence": rec.get("quality_confidence", "medium"),
            "namespace": rec.get("namespace", "default"),
            "original_id": rec.get("id", ""),
        })

    # ── SICU: Memory Type Classification (only "store" records) ──
    sicu_data = []
    for rec in records:
        if rec["quality"] != "store":
            continue
        text = rec["content"].strip()
        if not text:
            continue
        sicu_data.append({
            "text": text,
            "label": rec["corrected_type"],  # episodic/semantic/preference/procedural/fact
            "confidence": rec.get("type_confidence", "medium"),
            "namespace": rec.get("namespace", "default"),
            "original_id": rec.get("id", ""),
        })

    # Split into train/test
    def split_data(data, test_frac):
        n_test = max(1, int(len(data) * test_frac))
        return data[n_test:], data[:n_test]

    sivu_train, sivu_test = split_data(sivu_data, args.test_split)
    sicu_train, sicu_test = split_data(sicu_data, args.test_split)

    # Write SIVU
    sivu_train_path = args.sivu_output.replace(".jsonl", "_train.jsonl")
    sivu_test_path = args.sivu_output.replace(".jsonl", "_test.jsonl")
    
    with open(sivu_train_path, "w") as f:
        for rec in sivu_train:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    with open(sivu_test_path, "w") as f:
        for rec in sivu_test:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    # Write SICU
    sicu_train_path = args.sicu_output.replace(".jsonl", "_train.jsonl")
    sicu_test_path = args.sicu_output.replace(".jsonl", "_test.jsonl")

    with open(sicu_train_path, "w") as f:
        for rec in sicu_train:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    with open(sicu_test_path, "w") as f:
        for rec in sicu_test:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    # Stats
    print(f"\n=== SIVU (Store/Reject) ===", file=sys.stderr)
    print(f"  Total: {len(sivu_data)}", file=sys.stderr)
    print(f"  Train: {len(sivu_train)}", file=sys.stderr)
    print(f"  Test:  {len(sivu_test)}", file=sys.stderr)
    sivu_labels = defaultdict(int)
    for d in sivu_data:
        sivu_labels[d["label"]] += 1
    for label, count in sorted(sivu_labels.items()):
        pct = count / len(sivu_data) * 100
        print(f"    {label}: {count} ({pct:.1f}%)", file=sys.stderr)

    print(f"\n=== SICU (Type Classification) ===", file=sys.stderr)
    print(f"  Total: {len(sicu_data)}", file=sys.stderr)
    print(f"  Train: {len(sicu_train)}", file=sys.stderr)
    print(f"  Test:  {len(sicu_test)}", file=sys.stderr)
    sicu_labels = defaultdict(int)
    for d in sicu_data:
        sicu_labels[d["label"]] += 1
    for label, count in sorted(sicu_labels.items()):
        pct = count / len(sicu_data) * 100
        print(f"    {label}: {count} ({pct:.1f}%)", file=sys.stderr)

    print(f"\n  Written:", file=sys.stderr)
    print(f"    {sivu_train_path} ({len(sivu_train)} records)", file=sys.stderr)
    print(f"    {sivu_test_path} ({len(sivu_test)} records)", file=sys.stderr)
    print(f"    {sicu_train_path} ({len(sicu_train)} records)", file=sys.stderr)
    print(f"    {sicu_test_path} ({len(sicu_test)} records)", file=sys.stderr)

    # Token estimation
    total_tokens_est = sum(len(rec["text"].split()) * 1.3 for rec in sivu_data)
    print(f"\n  Estimated token count: ~{int(total_tokens_est):,}", file=sys.stderr)


if __name__ == "__main__":
    main()
