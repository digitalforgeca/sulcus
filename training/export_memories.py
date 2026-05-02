#!/usr/bin/env python3
"""
Export all Sulcus memories for SIU training dataset preparation.

Pulls memories from the Sulcus API across all namespaces/agents,
with rate-limited detail fetches for truncated records.

Usage:
    python export_memories.py --api-url https://api.sulcus.ca --api-key <key> --output raw_memories.jsonl
"""

import argparse
import json
import sys
import time
import urllib.request
import urllib.error


def api_get(url: str, api_key: str, retries: int = 3, backoff: float = 2.0) -> dict | None:
    """Make a GET request with retry + exponential backoff on 429."""
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    })
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = backoff * (2 ** attempt)
                print(f"  429 rate limited, waiting {wait:.0f}s... (attempt {attempt+1}/{retries})", file=sys.stderr)
                time.sleep(wait)
            else:
                print(f"  HTTP {e.code} for {url}", file=sys.stderr)
                return None
    print(f"  Gave up after {retries} retries for {url}", file=sys.stderr)
    return None


def fetch_all_pages(api_url: str, api_key: str, namespace: str | None = None) -> list[dict]:
    """Export all memories via paginated list endpoint."""
    all_memories = []
    page = 1
    page_size = 100

    while True:
        params = f"page={page}&page_size={page_size}&sort=updated_at&order=desc"
        if namespace:
            params += f"&namespace={namespace}"
        url = f"{api_url.rstrip('/')}/api/v1/agent/nodes?{params}"
        
        print(f"  Fetching page {page}...", file=sys.stderr)
        data = api_get(url, api_key)
        if not data:
            break

        nodes = data.get("items") or data.get("nodes") or []
        if not nodes:
            break

        for node in nodes:
            all_memories.append({
                "id": node.get("id"),
                "content": node.get("label") or node.get("pointer_summary", ""),
                "memory_type": node.get("memory_type", "episodic"),
                "heat": node.get("heat", 0),
                "base_utility": node.get("base_utility", 0),
                "namespace": node.get("namespace", "default"),
                "is_pinned": node.get("is_pinned", False),
                "modality": node.get("modality", "text"),
                "updated_at": node.get("updated_at"),
            })

        total = data.get("total", 0)
        print(f"  Got {len(nodes)} records (total: {total}, accumulated: {len(all_memories)})", file=sys.stderr)

        if total and len(all_memories) >= total:
            break
        if len(nodes) < page_size:
            break
        page += 1
        time.sleep(0.3)  # gentle rate limiting between pages

    return all_memories


def expand_truncated(api_url: str, api_key: str, memories: list[dict], delay: float = 0.5) -> int:
    """Fetch full content for records that appear truncated (128 char cutoff)."""
    expanded = 0
    truncated = [(i, m) for i, m in enumerate(memories) if m["content"] and len(m["content"]) >= 127]
    total = len(truncated)
    
    if not total:
        return 0

    print(f"\n  Expanding {total} truncated records (delay {delay}s between requests)...", file=sys.stderr)
    
    for batch_idx, (i, mem) in enumerate(truncated):
        url = f"{api_url.rstrip('/')}/api/v1/agent/nodes/{mem['id']}"
        detail = api_get(url, api_key, retries=3, backoff=3.0)
        
        if detail:
            full_content = detail.get("label", "")  # API returns "label", we store as "content"
            if full_content and len(full_content) > len(mem["content"]):
                memories[i]["content"] = full_content
                expanded += 1
        
        if (batch_idx + 1) % 50 == 0:
            print(f"  Progress: {batch_idx+1}/{total} ({expanded} expanded)", file=sys.stderr)
        
        time.sleep(delay)

    return expanded


def main():
    parser = argparse.ArgumentParser(description="Export Sulcus memories for SIU training")
    parser.add_argument("--api-url", required=True, help="Sulcus API base URL")
    parser.add_argument("--api-key", required=True, help="Bearer token / API key")
    parser.add_argument("--output", default="raw_memories.jsonl", help="Output JSONL file")
    parser.add_argument("--namespace", default=None, help="Filter by namespace (omit for all)")
    parser.add_argument("--expand-delay", type=float, default=0.5, help="Delay between detail fetches (seconds)")
    parser.add_argument("--skip-expand", action="store_true", help="Skip expanding truncated records")
    args = parser.parse_args()

    print(f"Exporting memories from {args.api_url}...", file=sys.stderr)
    memories = fetch_all_pages(args.api_url, args.api_key, args.namespace)
    print(f"\nFetched {len(memories)} total records from list endpoint", file=sys.stderr)

    if not args.skip_expand:
        expanded = expand_truncated(args.api_url, args.api_key, memories, args.expand_delay)
        print(f"  Expanded {expanded} truncated records", file=sys.stderr)

    # Write output
    with open(args.output, "w") as f:
        for mem in memories:
            f.write(json.dumps(mem, ensure_ascii=False) + "\n")

    print(f"\nExported {len(memories)} memories to {args.output}", file=sys.stderr)

    # Summary stats
    by_ns = {}
    by_type = {}
    truncated_remaining = 0
    for m in memories:
        ns = m["namespace"]
        mt = m["memory_type"]
        by_ns[ns] = by_ns.get(ns, 0) + 1
        by_type[mt] = by_type.get(mt, 0) + 1
        if m["content"] and len(m["content"]) >= 127:
            truncated_remaining += 1

    print("\nBy namespace:", file=sys.stderr)
    for ns, count in sorted(by_ns.items(), key=lambda x: -x[1]):
        print(f"  {ns}: {count}", file=sys.stderr)

    print("\nBy type:", file=sys.stderr)
    for mt, count in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {mt}: {count}", file=sys.stderr)

    if truncated_remaining:
        print(f"\n⚠ {truncated_remaining} records still truncated at 128 chars", file=sys.stderr)


if __name__ == "__main__":
    main()
