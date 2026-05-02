#!/usr/bin/env python3
"""
export_recall_data.py — Export recall_sessions data as SIRU training JSONL.

Connects to the Sulcus Postgres database and exports recall_sessions joined with
golden_index metadata to produce training examples for SIRU.

Training format:
  {"text": "query ||| memory_label ||| memory_type ||| source ||| heat", "label": "include|drop"}

Label assignment:
  - Memories that were selected (in memory_ids array) → "include"
  - Memories that were candidates but not selected → "drop"
  - If was_useful=true on the recall session, all included memories get boosted confidence
  - If was_useful=false, included memories get downgraded (some flipped to "drop")

Usage:
    export DATABASE_URL="postgres://..."
    python export_recall_data.py --output siru_training.jsonl
"""

import argparse
import json
import os
import sys

try:
    import psycopg2
except ImportError:
    print("pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Export SIRU training data from recall_sessions")
    parser.add_argument("--output", default="siru_training.jsonl", help="Output JSONL path")
    parser.add_argument("--limit", type=int, default=10000, help="Max recall sessions to export")
    parser.add_argument("--db-url", default=os.environ.get("DATABASE_URL", ""), help="Postgres connection URL")
    args = parser.parse_args()

    if not args.db_url:
        print("ERROR: Set DATABASE_URL or pass --db-url", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(args.db_url)
    cur = conn.cursor()

    # Get recall sessions with their metadata
    cur.execute("""
        SELECT rs.id, rs.query_text, rs.memory_ids, rs.memory_scores, rs.memory_sources,
               rs.candidates_total, rs.candidates_selected, rs.was_useful
        FROM recall_sessions rs
        ORDER BY rs.created_at DESC
        LIMIT %s
    """, (args.limit,))

    sessions = cur.fetchall()
    print(f"Loaded {len(sessions)} recall sessions", file=sys.stderr)

    examples = []
    for row in sessions:
        session_id, query, mem_ids, scores, sources, total, selected, was_useful = row
        
        if not mem_ids:
            continue

        # For each selected memory, look up its metadata
        for i, mem_id in enumerate(mem_ids):
            cur.execute("""
                SELECT label, memory_type, current_heat
                FROM golden_index
                WHERE id = %s::uuid
            """, (mem_id,))
            mem_row = cur.fetchone()
            if not mem_row:
                continue

            label_text, mem_type, heat = mem_row
            source = sources[i] if i < len(sources) else "unknown"
            score = scores[i] if i < len(scores) else 0.0

            # Build training text: query ||| memory context
            text = f"{query} ||| {label_text or ''} ||| {mem_type or 'episodic'} ||| {source} ||| {heat:.2f}"

            # Determine label
            if was_useful is False:
                # Session was marked not useful → these memories were bad picks
                train_label = "drop"
            else:
                # Selected = include (was_useful=True or None both count)
                train_label = "include"

            examples.append({"text": text, "label": train_label, "score": float(score)})

    # Write output
    with open(args.output, "w") as f:
        for ex in examples:
            f.write(json.dumps(ex) + "\n")

    label_counts = {}
    for ex in examples:
        label_counts[ex["label"]] = label_counts.get(ex["label"], 0) + 1

    print(f"Exported {len(examples)} training examples → {args.output}", file=sys.stderr)
    print(f"  Distribution: {label_counts}", file=sys.stderr)
    print(f"\nNote: 'summarize' class will need manual annotation or synthetic generation.", file=sys.stderr)
    print(f"Bootstrap: use high-score includes as 'include', low-score includes as 'summarize',", file=sys.stderr)
    print(f"  and non-selected candidates (requires separate query) as 'drop'.", file=sys.stderr)

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
