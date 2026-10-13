"""Needle In A Haystack (NIAH) & Multi-Needle Generator.

Generates Google Gemini-style context haystacks with single, multi-needle,
and adversarial distractor needles injected at specific depths.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any

# Standard noise corpus paragraphs for background haystack
HAYSTACK_CORPUS = [
    "Distributed consensus protocols like Raft ensure state machine replication across a cluster of nodes. Leaders handle log replication while followers acknowledge entries in quorum.",
    "PostgreSQL utilizes Multi-Version Concurrency Control (MVCC) to ensure snapshot isolation without read locks. Dead tuples are cleaned asynchronously by autovacuum workers.",
    "WebRTC establishes peer-to-peer data channels using Interactive Connectivity Establishment (ICE), Session Traversal Utilities for NAT (STUN), and Traversal Using Relays around NAT (TURN).",
    "Modern GPU rendering pipelines execute vertex, geometry, and fragment shaders in parallel across streaming multiprocessors with hardware-accelerated ray tracing cores.",
    "Linux kernel memory management divides physical RAM into zones (ZONE_NORMAL, ZONE_HIGHMEM) and allocates pages using a buddy allocator combined with slab caching.",
    "Kubernetes controllers continuously reconcile the current state of cluster resources against the desired declarative specification defined in manifests.",
    "TLS 1.3 reduces handshake latency to a single round-trip by sending key shares in the initial ClientHello and dropping support for legacy cipher suites.",
    "B-trees and LSM-trees represent the two primary on-disk storage architectures for relational databases and key-value stores with differing read/write amplification tradeoffs.",
    "HTTP/2 multiplexes multiple bidirectional streams over a single TCP connection using HPACK header compression and binary framing.",
    "Kafka partitions provide horizontal scalability by distributing append-only log segments across brokers with consumer group offset tracking.",
    "Redis operates as an in-memory data structure server supporting strings, hashes, sorted sets, streams, and bitmaps with asynchronous persistence options.",
    "ARM64 architecture employs a weakly-ordered memory model requiring explicit memory barriers (DMB, DSB, ISB) to guarantee ordering across CPU cores.",
    "Vector similarity search utilizes Hierarchical Navigable Small World (HNSW) graphs to compute approximate nearest neighbors with logarithmic search complexity.",
    "DNS resolution traverses recursive resolvers, root name servers, top-level domain servers, and authoritative name servers with TTL-based caching.",
    "Garbage collection algorithms like ZGC and Shenandoah achieve sub-millisecond pause times through concurrent mark, concurrent prepare for relocate, and colored pointers.",
]


@dataclass
class NeedleItem:
    needle_id: str
    fact_text: str
    target_value: str
    query_question: str
    depth_percent: float  # 0.0 to 1.0


@dataclass
class NiahTestCase:
    test_id: str
    test_type: str  # "single", "multi", "adversarial"
    target_tokens: int
    needles: list[NeedleItem]
    query: str
    expected_values: list[str]
    fail_indicators: list[str] = field(default_factory=list)
    adversarial_foils: list[str] = field(default_factory=list)


def generate_haystack_turns(target_tokens: int) -> list[str]:
    """Generate background noise turns totaling approximately target_tokens."""
    turns: list[str] = []
    current_tokens = 0
    corpus_idx = 0

    while current_tokens < target_tokens:
        base_text = HAYSTACK_CORPUS[corpus_idx % len(HAYSTACK_CORPUS)]
        # Prefix with unique section identifier to maintain uniqueness
        text = f"[Doc {corpus_idx + 1}] {base_text}"
        words = text.split()
        token_est = int(len(words) * 1.3)
        turns.append(text)
        current_tokens += token_est
        corpus_idx += 1

    return turns


def build_niah_scenario(
    test_type: str = "single",
    target_tokens: int = 5000,
    depth: float = 0.5,
    seed: int = 42,
) -> tuple[list[str], NiahTestCase]:
    """Build a complete NIAH conversation turn sequence with injected needles."""
    random.seed(seed)
    haystack = generate_haystack_turns(target_tokens)
    total_slots = max(len(haystack), 5)

    if test_type == "single":
        key_id = f"K-{seed % 900 + 100}"
        needle = NeedleItem(
            needle_id="single-key",
            fact_text=f"The master encryption key for Project Icarus cluster is '{key_id}'.",
            target_value=key_id,
            query_question="What is the master encryption key for the Project Icarus cluster?",
            depth_percent=depth,
        )
        insert_idx = min(int(total_slots * depth), len(haystack))
        haystack.insert(insert_idx, needle.fact_text)

        test_case = NiahTestCase(
            test_id=f"niah-single-{int(depth * 100)}pct-{target_tokens}tok",
            test_type="single",
            target_tokens=target_tokens,
            needles=[needle],
            query=needle.query_question,
            expected_values=[key_id],
            fail_indicators=["I don't know", "not found"],
        )
        return haystack, test_case

    elif test_type == "multi":
        port = f"{8000 + (seed % 900)}"
        datacenter = f"us-east-zone-{chr(65 + (seed % 4))}"
        admin = f"operator-{seed % 50}"

        needles = [
            NeedleItem(
                needle_id="multi-port",
                fact_text=f"The internal telemetry gateway is configured on port {port}.",
                target_value=port,
                query_question="",
                depth_percent=0.20,
            ),
            NeedleItem(
                needle_id="multi-dc",
                fact_text=f"The primary backup cluster is provisioned in datacenter '{datacenter}'.",
                target_value=datacenter,
                query_question="",
                depth_percent=0.50,
            ),
            NeedleItem(
                needle_id="multi-admin",
                fact_text=f"The lead on-call administrator for emergency maintenance is '{admin}'.",
                target_value=admin,
                query_question="",
                depth_percent=0.80,
            ),
        ]

        # Insert needles at respective depths in order
        for n in reversed(needles):
            idx = min(int(total_slots * n.depth_percent), len(haystack))
            haystack.insert(idx, n.fact_text)

        test_case = NiahTestCase(
            test_id=f"niah-multi-3needle-{target_tokens}tok",
            test_type="multi",
            target_tokens=target_tokens,
            needles=needles,
            query="What is the internal telemetry port, the primary backup datacenter, and the lead on-call administrator?",
            expected_values=[port, datacenter, admin],
            fail_indicators=["unknown", "not mentioned"],
        )
        return haystack, test_case

    else:  # adversarial
        real_val = f"active-val-{seed % 1000}"
        distractor_val = f"draft-val-{seed % 1000}"

        distractor_text = f"Notice: The preliminary draft parameter was '{distractor_val}', which was discarded."
        real_text = f"Confirmed: The final production parameter in effect is '{real_val}'."

        d_idx = min(int(total_slots * 0.3), len(haystack))
        haystack.insert(d_idx, distractor_text)

        r_idx = min(int(total_slots * depth), len(haystack))
        haystack.insert(r_idx, real_text)

        needle = NeedleItem(
            needle_id="adv-real",
            fact_text=real_text,
            target_value=real_val,
            query_question="What is the final production parameter in effect?",
            depth_percent=depth,
        )

        test_case = NiahTestCase(
            test_id=f"niah-adversarial-{int(depth * 100)}pct-{target_tokens}tok",
            test_type="adversarial",
            target_tokens=target_tokens,
            needles=[needle],
            query=needle.query_question,
            expected_values=[real_val],
            fail_indicators=[distractor_val],
            adversarial_foils=[distractor_val],
        )
        return haystack, test_case
