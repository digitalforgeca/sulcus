#!/usr/bin/env python3
"""
Generate synthetic ephemeral noise examples for SIVU reject training.

Creates ~50 realistic-looking but valueless memory snippets:
heartbeat checks, status pings, meditation logs, session artifacts,
compaction noise, and other ephemeral content that SIVU should reject.

Usage:
    python generate_synthetic_noise.py --output synthetic_noise.jsonl
"""

import argparse
import json
import random
import uuid
from datetime import datetime, timedelta

random.seed(42)

# ── TEMPLATES ──

HEARTBEAT_TEMPLATES = [
    "Heartbeat check completed. All systems nominal.",
    "HEARTBEAT_OK — nothing new since last check.",
    "Periodic heartbeat: email clear, calendar clear, no pending tasks.",
    "Running heartbeat cycle... no urgent items found.",
    "Heartbeat: checked email (0 unread), calendar (no events next 2h), weather (clear).",
    "Routine check-in. Nothing to report.",
    "Heartbeat pulse — all quiet on the western front.",
    "System heartbeat: API healthy, memory backend responding, no errors.",
    "Heartbeat at {time}. No actionable items.",
    "Quick pulse check — inbox empty, no mentions, calendar clear until tomorrow.",
]

STATUS_PINGS = [
    "Status: online. Waiting for instructions.",
    "Session active. No pending tasks.",
    "Ready and standing by.",
    "Acknowledged. Standing by for further input.",
    "System check passed. Idle.",
    "Monitoring channels. Nothing new.",
    "Active session — no work items in queue.",
    "Connection verified. Latency: {latency}ms.",
    "Backend health check: all services green.",
    "Memory sync complete. {count} nodes in namespace.",
]

MEDITATION_LOGS = [
    "Reviewed today's work. No significant decisions to record.",
    "End of day reflection: routine day, nothing memorable.",
    "Session winding down. No new learnings to capture.",
    "Quiet session. Read some files, no changes made.",
    "Checked in, nothing needed. Signing off.",
    "Brief session — answered a few questions, no major work.",
    "Reviewed heartbeat state. Everything current.",
    "Updated last-check timestamps. No content changes.",
    "Scanned recent memory files. All up to date.",
    "End of session. Nothing to commit.",
]

COMPACTION_ARTIFACTS = [
    "Session was just compacted. Prior context summarized above.",
    "Pre-compaction memory flush — saving working context.",
    "Context window approaching limit. Compacting.",
    "Compaction cycle triggered. Preserving key decisions.",
    "Memory pressure detected. Running compaction pass.",
    "Session history truncated at message boundary.",
    "Compaction complete. {count} messages preserved.",
]

EPHEMERAL_FRAGMENTS = [
    "ok",
    "done",
    "yes",
    "got it",
    "understood",
    "👍",
    "ack",
    "noted",
    "checking...",
    "one moment",
    "working on it",
    "let me look",
    "hmm",
    "interesting",
    "NO_REPLY",
    "[Image]",
    "...",
    "brb",
    "k",
    "ty",
]

SYSTEM_NOISE = [
    "Current time: Monday, March 24th, 2026 — 3:47 PM (America/Vancouver)",
    "OpenClaw runtime context (internal): session=main, channel=discord",
    "This is your channel pulse for #general. Recent activity: 3 messages.",
    "Tool call completed successfully. No output to display.",
    "Function returned: null",
    "Cron job executed. Next run in 30 minutes.",
    "Rate limit hit (429). Backing off 5 seconds.",
    "Session reconnected after network interruption.",
    "Plugin loaded: memory-tools v3.6.1",
    "Webhook received but no handler matched.",
]


def generate_noise(count: int = 55) -> list[dict]:
    """Generate synthetic noise records."""
    records = []
    
    all_templates = [
        (HEARTBEAT_TEMPLATES, "heartbeat", "episodic"),
        (STATUS_PINGS, "status_ping", "episodic"),
        (MEDITATION_LOGS, "empty_reflection", "episodic"),
        (COMPACTION_ARTIFACTS, "compaction", "episodic"),
        (EPHEMERAL_FRAGMENTS, "fragment", "episodic"),
        (SYSTEM_NOISE, "system_noise", "episodic"),
    ]
    
    # Distribute roughly evenly, with more fragments
    weights = [8, 8, 7, 5, 17, 10]
    
    for (templates, reason, mem_type), target_count in zip(all_templates, weights):
        for _ in range(target_count):
            template = random.choice(templates)
            
            # Fill template variables
            text = template.format(
                time=f"{random.randint(0,23):02d}:{random.randint(0,59):02d}",
                latency=random.randint(12, 450),
                count=random.randint(50, 2000),
            ) if "{" in template else template
            
            records.append({
                "id": str(uuid.uuid4()),
                "content": text,
                "memory_type": mem_type,
                "heat": round(random.uniform(0.0, 0.3), 3),
                "base_utility": round(random.uniform(0.0, 0.2), 3),
                "namespace": random.choice(["daedalus", "icarus", "ariadne"]),
                "is_pinned": False,
                "modality": "text",
                "updated_at": (datetime(2026, 3, 1) + timedelta(
                    days=random.randint(0, 30),
                    hours=random.randint(0, 23),
                    minutes=random.randint(0, 59),
                )).isoformat() + "Z",
                "quality": "reject",
                "quality_reason": reason,
                "quality_confidence": "high",
                "corrected_type": mem_type,
                "type_confidence": "high",
                "content_hash": f"synth_{uuid.uuid4().hex[:12]}",
                "auto_labeled": True,
                "human_reviewed": False,
                "pii_replacements": 0,
                "synthetic": True,
            })
    
    random.shuffle(records)
    return records[:count]


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic noise for SIVU training")
    parser.add_argument("--output", default="synthetic_noise.jsonl", help="Output file")
    parser.add_argument("--count", type=int, default=55, help="Number of examples to generate")
    args = parser.parse_args()
    
    records = generate_noise(args.count)
    
    with open(args.output, "w") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    
    print(f"Generated {len(records)} synthetic noise examples → {args.output}", file=sys.stderr)
    
    # Breakdown
    from collections import Counter
    reasons = Counter(r["quality_reason"] for r in records)
    print(f"\nBreakdown:", file=sys.stderr)
    for reason, count in reasons.most_common():
        print(f"  {reason}: {count}", file=sys.stderr)


if __name__ == "__main__":
    import sys
    main()
