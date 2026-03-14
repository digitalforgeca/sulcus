"""MemBench — OpenAI Assistants adapter.

Uses OpenAI Assistants API with thread-level memory.
Each task runs in a fresh thread. The assistant sees all prior messages
in the thread as "memory" — this is native long-context memory.

Requires: pip install openai
Set: OPENAI_API_KEY environment variable
"""

from __future__ import annotations

import os
import time
from ..runner.types import BenchTask, TaskResult
from ..runner.scoring import score_standard
from .base import BaseAdapter


class Adapter(BaseAdapter):
    """OpenAI Assistants API adapter with thread memory."""

    def __init__(
        self,
        api_key: str = "",
        model: str = "gpt-4o-mini",
        **kwargs,
    ):
        try:
            import openai
        except ImportError:
            raise ImportError("openai adapter requires: pip install openai")

        key = api_key or os.environ.get("OPENAI_API_KEY", "")
        if not key:
            raise ValueError("OpenAI adapter requires OPENAI_API_KEY")

        import openai as _openai
        self.client = _openai.OpenAI(api_key=key)
        self.model = model
        self.name = "openai-assistants"
        self._assistant_id: str | None = None
        self._thread_id: str | None = None
        self._ensure_assistant()

    def _ensure_assistant(self) -> None:
        asst = self.client.beta.assistants.create(
            name="MemBench Tester",
            instructions=(
                "You are a helpful assistant. Remember everything the user tells you. "
                "When asked about past information, recall it accurately from the conversation."
            ),
            model=self.model,
        )
        self._assistant_id = asst.id

    def reset(self) -> None:
        """Create a fresh thread to clear memory."""
        thread = self.client.beta.threads.create()
        self._thread_id = thread.id

    def run_task(self, task: BenchTask) -> TaskResult:
        t0 = time.time()
        error = None
        self.reset()  # fresh thread per task

        try:
            # Feed conversation turns
            for turn in task.conversation:
                if turn.role == "user":
                    self.client.beta.threads.messages.create(
                        thread_id=self._thread_id,
                        role="user",
                        content=turn.content,
                    )
                    # Run the assistant to generate a response for each user turn
                    run = self.client.beta.threads.runs.create_and_poll(
                        thread_id=self._thread_id,
                        assistant_id=self._assistant_id,
                    )
                    if run.status != "completed":
                        raise RuntimeError(f"Run failed: {run.status}")

            # Now ask the benchmark query
            self.client.beta.threads.messages.create(
                thread_id=self._thread_id,
                role="user",
                content=task.query,
            )
            run = self.client.beta.threads.runs.create_and_poll(
                thread_id=self._thread_id,
                assistant_id=self._assistant_id,
            )
            if run.status != "completed":
                raise RuntimeError(f"Final run failed: {run.status}")

            # Extract last assistant message
            messages = self.client.beta.threads.messages.list(
                thread_id=self._thread_id,
                order="desc",
                limit=1,
            )
            response = ""
            for msg in messages.data:
                if msg.role == "assistant":
                    for block in msg.content:
                        if block.type == "text":
                            response = block.text.value
                            break
                    break

        except Exception as e:
            error = str(e)
            response = ""

        latency = int((time.time() - t0) * 1000)
        return score_standard(task, response, self.name, latency, error)
