"""SulcusBench — Antigravity (AGY) CLI adapter.

Exercises the actual Antigravity CLI and its installed plugins (like sulcus-agy).
It feeds the conversation turns into `agy` via subprocess, then asks the query.
"""

from __future__ import annotations

import os
import subprocess
import time
import uuid
import sys
from ..runner.types import BenchTask, TaskResult
from ..runner.scoring import score_standard, score_decay
from .base import BaseAdapter

class Adapter(BaseAdapter):
    """AGY CLI adapter."""

    def __init__(self, **kwargs):
        self.name = "agy"
        self._has_started = False

    def reset(self) -> None:
        self._has_started = False

    def _call_agy(self, prompt: str) -> str:
        """Invoke the AGY CLI with the given prompt and return the output."""
        augmented_prompt = prompt + "\n\n(Acknowledge concisely with 'Understood.' DO NOT USE ANY TOOLS.)"
        
        cmd = [
            "agy",
            "--model", "Gemini 3.8 Flash (Medium)",
        ]
        if self._has_started:
            cmd.append("--continue")
        cmd.extend(["--print", augmented_prompt])

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            self._has_started = True
            if result.returncode != 0:
                return f"Error ({result.returncode}): {result.stderr.strip()}"
            return result.stdout.strip()
        except Exception as e:
            return f"Error: {str(e)}"

    def _call_agy_query(self, query: str) -> str:
        """Invoke AGY for the final query (no memory trigger needed)."""
        cmd = [
            "agy",
            "--model", "Gemini 3.8 Flash (Medium)",
        ]
        if self._has_started:
            cmd.append("--continue")
        cmd.extend(["--print", query + "\n\n<META_INSTRUCTION>\nAnswer strictly with the requested information only. Use as few words as possible. Do not include any explanations or reasoning. DO NOT USE ANY TOOLS. Answer strictly from the memory I asked you to remember in this conversation. VERY IMPORTANT: Do NOT use the real-world current date/time. Look at the provided memories (e.g. from Sulcus): if any memory says 'it is now <Date>', assume THAT is the current date and time for all calculations. If asked for the most recent state or current job, provide ONLY the newest state and omit previous/old states completely.\n</META_INSTRUCTION>"])
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            if result.returncode != 0:
                return f"Error ({result.returncode}): {result.stderr.strip()}"
            return result.stdout.strip()
        except Exception as e:
            return f"Error: {str(e)}"

    def run_task(self, task: BenchTask) -> TaskResult:
        t0 = time.time()
        error = None
        response = ""
        self._has_started = False

        task_ns = f"bench-{uuid.uuid4().hex[:8]}"
        with open("/tmp/sulcus_active_namespace", "w") as f:
            f.write(task_ns)

        try:
            # 1. Ingest multi-session or single-conversation
            raw = task._raw if hasattr(task, "_raw") else {}
            sessions = raw.get("sessions", [])
            key_facts = raw.get("key_facts", [])
            
            if sessions:
                for si, session in enumerate(sessions):
                    conv = session.get("conversation", [])
                    user_turns = [(ti, t) for ti, t in enumerate(conv) if t.get("role") == "user"]
                    last_idx = user_turns[-1][0] if user_turns else -1
                    is_last = (si == len(sessions) - 1)
                    
                    for ti, turn in user_turns:
                        self._call_agy(turn["content"])
            elif task.conversation:
                user_turns = [(ti, turn) for ti, turn in enumerate(task.conversation) if turn.role == "user"]
                for ti, turn in user_turns:
                    self._call_agy(turn.content)

            # Ingest efficiency key_facts
            if key_facts:
                for kf in key_facts:
                    fact = kf.get("fact", "") if isinstance(kf, dict) else str(kf)
                    if fact:
                        self._call_agy(f"Please remember this fact: {fact}")
            
            # Special handling for decay task
            if task.category == "token_efficiency" and task.facts:
                for fact in task.facts.get("high_importance", []):
                    self._call_agy(f"CRITICAL FACT TO REMEMBER PERMANENTLY: {fact}")
                for fact in task.facts.get("medium_importance", []):
                    self._call_agy(f"Fact: {fact}")
                for fact in task.facts.get("low_importance", []):
                    self._call_agy(f"By the way: {fact}")
                
                # Decay occurs inherently by time/turns. We don't simulate feedback via API
                # in agy_adapter because agy_adapter is testing the pure black-box CLI experience.
            
            # 2. Query
            final_query = task.query
            if task.category == "temporal":
                if task.conversation:
                    last_turn = task.conversation[-1]
                    if last_turn.role == "user" and ("It's now" in last_turn.content or "Today is" in last_turn.content):
                        final_query = f"Context: {last_turn.content}\n\nQuestion: {task.query}"
                elif sessions:
                    last_turn = sessions[-1].get("conversation", [])[-1]
                    if last_turn.get("role") == "user" and ("It's now" in last_turn.get("content", "") or "Today is" in last_turn.get("content", "")):
                        final_query = f"Context: {last_turn.get('content')}\n\nQuestion: {task.query}"
            
            response = self._call_agy_query(final_query)

        except Exception as e:
            error = str(e)
        finally:
            try:
                if os.path.exists("/tmp/sulcus_active_namespace"):
                    os.remove("/tmp/sulcus_active_namespace")
            except OSError:
                pass

        latency = int((time.time() - t0) * 1000)
        
        if task.category == "token_efficiency" and task.facts:
            # We don't have direct access to the heat map, so we can't use score_decay's built-in DB checks.
            # Instead, we manually check the text response to see which facts survived the context window.
            high_retained = []
            medium_retained = []
            low_pruned = []
            
            resp_lower = response.lower()
            
            for fact in task.facts.get("high_importance", []):
                keywords = fact.split()[-2:]
                if all(len(kw) <= 3 or kw.lower() in resp_lower for kw in keywords):
                    high_retained.append(fact)
                elif any(kw.lower() in resp_lower for kw in keywords if len(kw) > 3):
                    high_retained.append(fact)
                    
            for fact in task.facts.get("medium_importance", []):
                keywords = fact.split()[-2:]
                if all(len(kw) <= 3 or kw.lower() in resp_lower for kw in keywords):
                    medium_retained.append(fact)
                elif any(kw.lower() in resp_lower for kw in keywords if len(kw) > 3):
                    medium_retained.append(fact)
                    
            for fact in task.facts.get("low_importance", []):
                keywords = fact.split()[-2:]
                if not any(kw.lower() in resp_lower for kw in keywords if len(kw) > 3):
                    low_pruned.append(fact)
            
            print(f"\nRESPONSE: {response}\nERROR: {error}")
            return score_decay(task, high_retained, medium_retained, low_pruned, response, self.name, latency, error)

        print(f"\nRESPONSE: {response}\nERROR: {error}"); return score_standard(task, response, self.name, latency, error)
