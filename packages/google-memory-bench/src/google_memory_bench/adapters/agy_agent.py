"""AGY Agent Adapter for Google Memory Benchmarks.

Runs end-to-end evaluations through the Antigravity CLI and the
sulcus-agy proactive plugin, evaluating agent-level memory integration.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from typing import Any

from .base import BaseAdapter


class AgyAgentAdapter(BaseAdapter):
    """End-to-end adapter using AGY CLI subprocess."""

    name: str = "agy-agent"

    def __init__(
        self,
        model: str = "Gemini 3.8 Flash (Medium)",
        namespace: str = "",
    ):
        self.model = model
        self.namespace = namespace or f"bench-{uuid.uuid4().hex[:8]}"
        self._has_started = False
        self._write_active_ns()

    def _write_active_ns(self) -> None:
        try:
            with open("/tmp/sulcus_active_namespace", "w") as f:
                f.write(self.namespace)
        except OSError:
            pass

    def reset(self, namespace: str | None = None) -> None:
        self.namespace = namespace or f"bench-{uuid.uuid4().hex[:8]}"
        self._has_started = False
        self._write_active_ns()

    def store(
        self,
        content: str,
        memory_type: str = "episodic",
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Inject turn into agent session for proactive capture."""
        self._write_active_ns()
        prompt = content + "\n\n(Acknowledge concisely with 'Understood.' DO NOT USE ANY TOOLS.)"
        cmd = ["agy", "--model", self.model]
        if self._has_started:
            cmd.append("--continue")
        cmd.extend(["--print", prompt])

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            self._has_started = True
            return "stored" if result.returncode == 0 else f"error:{result.stderr.strip()}"
        except Exception as e:
            return f"error:{str(e)}"

    def query(self, query_text: str, top_k: int = 10) -> str:
        """Query agent with meta-instructions for concise factual response."""
        self._write_active_ns()
        meta = (
            "\n\n<META_INSTRUCTION>\n"
            "Answer strictly with the requested information only. Use as few words as possible. "
            "Do not include explanations or reasoning. Answer strictly from the memories provided. "
            "DO NOT USE ANY TOOLS.\n"
            "</META_INSTRUCTION>"
        )
        cmd = ["agy", "--model", self.model]
        if self._has_started:
            cmd.append("--continue")
        cmd.extend(["--print", query_text + meta])

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            if result.returncode != 0:
                return f"Error ({result.returncode}): {result.stderr.strip()}"
            return result.stdout.strip()
        except Exception as e:
            return f"Error: {str(e)}"
