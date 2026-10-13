"""Google DeepMind Evo-Memory & ReasoningBank Task Streams.

Defines sequential task streams evaluating:
- Test-Time Learning (TTL): Reusing prior execution experiences
- Conflict Resolution (CR): Updating obsolete procedures when requirements change
- Accurate Retrieval (AR): Surface exact operational knowledge across task shifts
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class EvoTaskStep:
    step_id: str
    role: str  # "user", "environment"
    content: str
    is_query: bool = False
    expected_answer: list[str] = field(default_factory=list)
    fail_indicators: list[str] = field(default_factory=list)


@dataclass
class EvoStream:
    stream_id: str
    name: str
    category: str  # "ttl", "conflict_resolution", "accurate_retrieval", "abstention"
    description: str
    steps: list[EvoTaskStep]


def get_evo_memory_streams() -> list[EvoStream]:
    """Return canonical task streams for Evo-Memory evaluation."""
    return [
        EvoStream(
            stream_id="evo-stream-01-experience-reuse",
            name="Operational Incident Experience Reuse (ExpRAG)",
            category="ttl",
            description="Agent must learn an incident resolution and reuse it in a subsequent task.",
            steps=[
                EvoTaskStep(
                    step_id="step-1",
                    role="user",
                    content=(
                        "Incident post-mortem: Our PostgreSQL cluster was locking up during maintenance. "
                        "We discovered VACUUM FULL was taking exclusive locks. We solved it by setting "
                        "autovacuum_vacuum_cost_limit to 1000 and autovacuum_vacuum_scale_factor to 0.05."
                    ),
                ),
                EvoTaskStep(
                    step_id="step-2",
                    role="user",
                    content="Let's look at setting up Prometheus metrics for our frontend API.",
                ),
                EvoTaskStep(
                    step_id="step-3",
                    role="user",
                    content=(
                        "Our database is experiencing high lock latency during routine cleanup again. "
                        "What exact parameters did we tune to fix this during the last incident?"
                    ),
                    is_query=True,
                    expected_answer=["autovacuum_vacuum_cost_limit", "1000", "0.05"],
                    fail_indicators=["VACUUM FULL", "I don't know"],
                ),
            ],
        ),
        EvoStream(
            stream_id="evo-stream-02-conflict-refinement",
            name="Architectural Migration & Conflict Resolution (ReMem)",
            category="conflict_resolution",
            description="Agent must discard obsolete tooling and apply the latest architectural directive.",
            steps=[
                EvoTaskStep(
                    step_id="step-1",
                    role="user",
                    content="We run all our background workers on HashiCorp Nomad with Consul.",
                ),
                EvoTaskStep(
                    step_id="step-2",
                    role="user",
                    content=(
                        "Update: We have completely migrated off Nomad. All background workers are now "
                        "deployed on Kubernetes using ArgoCD. Do not use Nomad anymore."
                    ),
                ),
                EvoTaskStep(
                    step_id="step-3",
                    role="user",
                    content="Where and how should we deploy the new payment reconciliation worker?",
                    is_query=True,
                    expected_answer=["Kubernetes", "ArgoCD"],
                    fail_indicators=["Nomad", "Consul"],
                ),
            ],
        ),
        EvoStream(
            stream_id="evo-stream-03-multi-step-trace",
            name="ReasoningBank Multi-Step Recovery Protocol",
            category="ttl",
            description="Agent must recall and preserve exact execution sequence learned from prior trace.",
            steps=[
                EvoTaskStep(
                    step_id="step-1",
                    role="user",
                    content=(
                        "Our standard service recovery sequence when experiencing cascading 503s is: "
                        "First drain ingress traffic via Cloudflare. Second flush regional Valkey caches. "
                        "Third rolling restart worker pool with concurrency cap 32."
                    ),
                ),
                EvoTaskStep(
                    step_id="step-2",
                    role="user",
                    content="Reviewed the weekly revenue numbers — looks like we grew 8% this week.",
                ),
                EvoTaskStep(
                    step_id="step-3",
                    role="user",
                    content="We have a cascading 503 outage right now. What is our required 3-step recovery sequence in order?",
                    is_query=True,
                    expected_answer=["drain ingress", "flush regional Valkey", "restart worker pool"],
                    fail_indicators=["I don't remember", "random restart"],
                ),
            ],
        ),
        EvoStream(
            stream_id="evo-stream-04-abstention-boundary",
            name="Adversarial Separation & Abstention",
            category="abstention",
            description="Agent must recall information for target project without hallucinating unshared facts.",
            steps=[
                EvoTaskStep(
                    step_id="step-1",
                    role="user",
                    content="Project Pegasus uses TLS client certificates stored in AWS KMS key alias/pegasus-ca.",
                ),
                EvoTaskStep(
                    step_id="step-2",
                    role="user",
                    content="What is the AWS KMS key alias for Project Orion's TLS certificates?",
                    is_query=True,
                    expected_answer=["not provided", "no information", "unknown"],
                    fail_indicators=["alias/pegasus-ca"],
                ),
            ],
        ),
    ]
