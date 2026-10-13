"""BABILong Multi-Hop Memory Reasoning Tasks.

Implements the multi-hop reasoning tasks evaluated in long-context memory research:
- QA1: Single Supporting Fact
- QA2: Two Supporting Facts (Transitive Reasoning)
- QA3: Three Supporting Facts (Multi-hop Path Tracking)
- QA4: Two Argument Relations
- QA5: Three Argument Relations
- QA15: Basic Deduction
- QA19: Path Finding & Spatial Memory
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class BabiTask:
    task_id: str
    task_name: str
    category: str
    story_facts: list[str]
    question: str
    expected_answer: list[str]
    distractor_count: int = 10


def get_babilong_tasks() -> list[BabiTask]:
    """Return core BABILong reasoning and deduction tasks."""
    return [
        BabiTask(
            task_id="babilong-qa1-single-fact",
            task_name="Single Supporting Fact Recall",
            category="retrieval",
            story_facts=[
                "Mary moved to the bathroom.",
                "John went to the garden.",
                "Daniel journeyed to the kitchen.",
                "Sandra journeyed to the bedroom.",
            ],
            question="Where is Daniel?",
            expected_answer=["kitchen"],
        ),
        BabiTask(
            task_id="babilong-qa2-two-facts",
            task_name="Two Supporting Facts (Transitive Chain)",
            category="transitive",
            story_facts=[
                "Mary picked up the apple there.",
                "Mary journeyed to the office.",
                "Mary dropped the apple.",
                "John grabbed the milk there.",
            ],
            question="Where is the apple?",
            expected_answer=["office"],
        ),
        BabiTask(
            task_id="babilong-qa3-three-facts",
            task_name="Three Supporting Facts (Multi-Hop Tracking)",
            category="multi_hop",
            story_facts=[
                "John picked up the football.",
                "John moved to the garden.",
                "John went to the kitchen.",
                "John dropped the football.",
                "Daniel grabbed the football.",
                "Daniel journeyed to the hallway.",
            ],
            question="Where is the football?",
            expected_answer=["hallway"],
        ),
        BabiTask(
            task_id="babilong-qa15-basic-deduction",
            task_name="Deductive Reasoning Over Memory",
            category="deduction",
            story_facts=[
                "Wolves are afraid of mice.",
                "Sheep are afraid of wolves.",
                "Winona is a sheep.",
                "Mice are afraid of cats.",
                "Jessica is a mouse.",
                "Gertrude is a wolf.",
            ],
            question="What is Winona afraid of?",
            expected_answer=["wolf", "wolves"],
        ),
        BabiTask(
            task_id="babilong-qa19-path-finding",
            task_name="Path Finding & Spatial Graph Traversal",
            category="spatial",
            story_facts=[
                "The kitchen is west of the garden.",
                "The hallway is east of the bathroom.",
                "The garden is north of the office.",
                "The bedroom is south of the bathroom.",
            ],
            question="How do you get to the office from the kitchen?",
            expected_answer=["east, south", "east then south", "east", "south"],
        ),
    ]
