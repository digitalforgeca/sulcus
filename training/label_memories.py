#!/usr/bin/env python3
"""
Auto-label Sulcus memories for SIU training.

Reads raw_memories.jsonl and produces labeled_memories.jsonl with:
- quality: "store" or "reject" (for SI Value Unit training)
- quality_reason: why rejected (system_prompt, duplicate, credential, test_artifact, ephemeral_noise, too_short)
- corrected_type: corrected memory type (for SI Classification Unit training)
- confidence: how confident the auto-labeler is (low/medium/high)

Heuristic labeling — catches obvious junk patterns. Human review needed for borderline cases.

Usage:
    python label_memories.py --input raw_memories_full.jsonl --output labeled_memories.jsonl
"""

import argparse
import json
import re
import sys
import hashlib
from collections import defaultdict

# ── REJECT PATTERNS (SI Value Unit: junk detection) ──

# System prompt / compaction artifacts
SYSTEM_PROMPT_PATTERNS = [
    re.compile(r'^\[?(?:cron|system|heartbeat|message_id|sender_id|conversation_label)', re.I),
    re.compile(r'^System:\s', re.I),
    re.compile(r'Pre-compaction memory flush', re.I),
    re.compile(r'session was just compacted', re.I),
    re.compile(r'You are running as a subagent', re.I),
    re.compile(r'^Current time:', re.I),
    re.compile(r'^\[Inter-session message\]', re.I),
    re.compile(r'This is your channel pulse', re.I),
    re.compile(r'HEARTBEAT\.md|heartbeat prompt', re.I),
    re.compile(r'openclaw\.inbound_meta', re.I),
    re.compile(r'sulcus-memories.*Relevant memories from Sulcus', re.I | re.S),
    re.compile(r'UNTRUSTED.*channel metadata', re.I),
    re.compile(r'<<<EXTERNAL_UNTRUSTED_CONTENT', re.I),
    re.compile(r'tool_call|function_call|<function_calls>', re.I),
    re.compile(r'OpenClaw runtime context \(internal\)', re.I),
    re.compile(r'Internal task completion event', re.I),
    re.compile(r'runtime-generated.*not user-authored', re.I),
]

# Credential / PII patterns
CREDENTIAL_PATTERNS = [
    re.compile(r'sk-[a-f0-9]{20,}', re.I),
    re.compile(r'Bearer\s+[A-Za-z0-9+/=]{20,}', re.I),
    re.compile(r'API[_\s]?[Kk]ey[:\s]+\S{15,}'),
    re.compile(r'(?:password|secret|token)[:\s=]+\S{10,}', re.I),
    re.compile(r'whsec_[A-Za-z0-9]{20,}'),
    re.compile(r'-----BEGIN.*PRIVATE KEY-----', re.I),
]

# Test / benchmark artifacts
TEST_PATTERNS = [
    re.compile(r'^test[_\s]?memory', re.I),
    re.compile(r'^membench\b', re.I),
    re.compile(r'MemBench.*benchmark', re.I),
    re.compile(r'^This is a test', re.I),
]

# Ephemeral noise (too transient to be useful)
EPHEMERAL_PATTERNS = [
    re.compile(r'^\[Image\]\s*$', re.I),
    re.compile(r'^NO_REPLY$', re.I),
    re.compile(r'^HEARTBEAT_OK$', re.I),
]

# Minimum content threshold
MIN_MEANINGFUL_CHARS = 30


def classify_quality(text: str, namespace: str) -> tuple[str, str, str]:
    """
    Classify whether a memory should be stored or rejected.
    Returns (quality, reason, confidence).
    """
    if not text or len(text.strip()) < MIN_MEANINGFUL_CHARS:
        return ("reject", "too_short", "high")

    for pat in SYSTEM_PROMPT_PATTERNS:
        if pat.search(text):
            return ("reject", "system_prompt", "high")

    for pat in CREDENTIAL_PATTERNS:
        if pat.search(text):
            return ("reject", "credential", "medium")

    for pat in TEST_PATTERNS:
        if pat.search(text):
            return ("reject", "test_artifact", "medium")

    for pat in EPHEMERAL_PATTERNS:
        if pat.search(text):
            return ("reject", "ephemeral_noise", "high")

    # Namespace-based signals
    if namespace == "membench":
        return ("reject", "test_artifact", "medium")

    return ("store", "", "medium")


def classify_type(text: str, current_type: str) -> tuple[str, str]:
    """
    Validate/correct memory type classification.
    Returns (corrected_type, confidence).
    
    These are heuristic corrections — the model will learn better patterns.
    """
    text_lower = text.lower()

    # Strong type signals
    if any(kw in text_lower for kw in ['how to', 'step 1', 'steps:', 'procedure:', 'workflow:', 'pipeline:', 'migration guide']):
        if current_type != "procedural":
            return ("procedural", "medium")

    if any(kw in text_lower for kw in ['dooley prefers', 'dooley wants', 'dooley likes', 'user prefers', 'preference:']):
        if current_type != "preference":
            return ("preference", "medium")

    if any(kw in text_lower for kw in ['version:', 'ip:', 'port:', 'url:', 'id:', 'key:', 'password:', 'endpoint:']):
        if current_type not in ("fact", "procedural"):
            return ("fact", "low")

    # "synthesis" and "moment" are non-standard types from the old system
    if current_type in ("synthesis", "moment"):
        # synthesis → semantic, moment → episodic
        if current_type == "synthesis":
            return ("semantic", "medium")
        return ("episodic", "medium")

    return (current_type, "high")


def compute_content_hash(text: str) -> str:
    """Simple hash for dedup detection."""
    normalized = re.sub(r'\s+', ' ', text.strip().lower())
    return hashlib.md5(normalized.encode()).hexdigest()[:12]


def main():
    parser = argparse.ArgumentParser(description="Auto-label Sulcus memories for SIU training")
    parser.add_argument("--input", required=True, help="Input JSONL from export")
    parser.add_argument("--output", default="labeled_memories.jsonl", help="Output labeled JSONL")
    parser.add_argument("--stats", action="store_true", help="Print detailed stats")
    args = parser.parse_args()

    memories = []
    with open(args.input) as f:
        for line in f:
            if line.strip():
                memories.append(json.loads(line))

    print(f"Loaded {len(memories)} memories", file=sys.stderr)

    # Dedup detection
    content_hashes = defaultdict(list)
    for i, m in enumerate(memories):
        h = compute_content_hash(m["content"])
        content_hashes[h].append(i)

    # Label each memory
    stats = {
        "total": len(memories),
        "store": 0,
        "reject": 0,
        "reject_reasons": defaultdict(int),
        "type_corrections": 0,
        "duplicates_marked": 0,
    }

    seen_hashes = set()
    labeled = []

    for i, mem in enumerate(memories):
        text = mem["content"]
        namespace = mem.get("namespace", "default")
        current_type = mem.get("memory_type", "episodic")

        # Quality classification
        quality, reason, q_confidence = classify_quality(text, namespace)

        # Dedup check (mark duplicates as reject)
        content_hash = compute_content_hash(text)
        if quality == "store" and content_hash in seen_hashes:
            quality = "reject"
            reason = "duplicate"
            q_confidence = "high"
            stats["duplicates_marked"] += 1
        seen_hashes.add(content_hash)

        # Type classification (only if storing)
        if quality == "store":
            corrected_type, t_confidence = classify_type(text, current_type)
            if corrected_type != current_type:
                stats["type_corrections"] += 1
        else:
            corrected_type = current_type
            t_confidence = "low"

        # Record stats
        if quality == "store":
            stats["store"] += 1
        else:
            stats["reject"] += 1
            stats["reject_reasons"][reason] += 1

        record = {
            **mem,
            "quality": quality,
            "quality_reason": reason,
            "quality_confidence": q_confidence,
            "corrected_type": corrected_type,
            "type_confidence": t_confidence,
            "content_hash": content_hash,
            "auto_labeled": True,
            "human_reviewed": False,
        }
        labeled.append(record)

    # Write output
    with open(args.output, "w") as f:
        for rec in labeled:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print(f"\nLabeled {len(labeled)} memories → {args.output}", file=sys.stderr)
    print(f"\n  ✅ Store: {stats['store']}", file=sys.stderr)
    print(f"  ❌ Reject: {stats['reject']}", file=sys.stderr)
    
    if stats["reject_reasons"]:
        print(f"\n  Reject breakdown:", file=sys.stderr)
        for reason, count in sorted(stats["reject_reasons"].items(), key=lambda x: -x[1]):
            print(f"    {reason}: {count}", file=sys.stderr)

    print(f"\n  🔄 Type corrections: {stats['type_corrections']}", file=sys.stderr)
    print(f"  🔁 Duplicates found: {stats['duplicates_marked']}", file=sys.stderr)

    if args.stats:
        # Detailed per-namespace/type breakdown
        by_ns_quality = defaultdict(lambda: {"store": 0, "reject": 0})
        by_type = defaultdict(int)
        for rec in labeled:
            by_ns_quality[rec["namespace"]][rec["quality"]] += 1
            if rec["quality"] == "store":
                by_type[rec["corrected_type"]] += 1

        print(f"\n  By namespace:", file=sys.stderr)
        for ns in sorted(by_ns_quality.keys()):
            q = by_ns_quality[ns]
            print(f"    {ns}: {q['store']} store / {q['reject']} reject", file=sys.stderr)

        print(f"\n  Stored by type:", file=sys.stderr)
        for t, c in sorted(by_type.items(), key=lambda x: -x[1]):
            print(f"    {t}: {c}", file=sys.stderr)


if __name__ == "__main__":
    main()
