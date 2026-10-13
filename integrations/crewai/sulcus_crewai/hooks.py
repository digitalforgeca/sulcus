"""SulcusCrewHooks — lifecycle callbacks for CrewAI agents and crews."""

from __future__ import annotations

from typing import Any, Optional

from sulcus import Sulcus


class SulcusCrewHooks:
    """Turnkey lifecycle hooks for CrewAI tasks and agent steps.

    Provides pre-task context injection and post-task finding capture.

    Usage::

        from sulcus import Sulcus
        from sulcus_crewai import SulcusCrewHooks
        from crewai import Crew

        client = Sulcus(api_key="sk-...")
        hooks = SulcusCrewHooks(client)

        crew = Crew(
            agents=[...],
            tasks=[...],
            step_callback=hooks.step_callback,
            task_callback=hooks.task_callback,
        )
    """

    def __init__(
        self,
        client: Sulcus,
        *,
        namespace: Optional[str] = None,
        auto_capture: bool = True,
        token_budget: int = 2000,
    ) -> None:
        self.client = client
        self.namespace = namespace or client.namespace
        self.auto_capture = auto_capture
        self.token_budget = token_budget

    def get_context(self, task_description: str) -> str:
        """Fetch Sulcus context for a task."""
        return self.client.build_context(
            query=task_description,
            token_budget=self.token_budget,
            namespace=self.namespace,
        )

    def step_callback(self, step_output: Any) -> None:
        """Callback invoked after an agent takes a step."""
        pass

    def task_callback(self, task_output: Any) -> None:
        """Callback invoked when a task completes to persist findings."""
        if not self.auto_capture:
            return

        raw = getattr(task_output, "raw", None) or str(task_output)
        if raw and len(raw.strip()) > 10:
            desc = getattr(task_output, "description", "Crew Task")
            content = f"Task: {desc}\nOutput: {raw}"
            try:
                self.client.remember(
                    content=content,
                    memory_type="episodic",
                    heat=0.8,
                    namespace=self.namespace,
                    train_on_this=True,
                )
            except Exception:
                pass
