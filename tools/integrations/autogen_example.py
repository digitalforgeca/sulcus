#!/usr/bin/env python3
"""
SULCUS × AutoGen (AG2) — Full integration example.

Requirements:
    pip install pyautogen

Usage:
    export OPENAI_API_KEY=sk-...
    cargo build -p sulcus
    python tools/integrations/autogen_example.py
"""

import json
import subprocess
import sys
from pathlib import Path

import autogen

# ── SULCUS sidecar ────────────────────────────────────────────────────────────

SULCUS_BIN = Path(__file__).parent.parent.parent / "target" / "debug" / "sulcus"
if not SULCUS_BIN.exists():
    sys.exit(f"Binary not found at {SULCUS_BIN}. Run: cargo build -p sulcus")

proc = subprocess.Popen(
    [str(SULCUS_BIN), "serve"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    text=True,
    bufsize=1,
)

_req_id = 0

def mcp(method: str, params: dict | None = None) -> dict:
    global _req_id
    _req_id += 1
    req = json.dumps({"jsonrpc": "2.0", "id": _req_id, "method": method, "params": params or {}})
    proc.stdin.write(req + "\n")
    proc.stdin.flush()
    return json.loads(proc.stdout.readline())

# ── Boot SULCUS ───────────────────────────────────────────────────────────────

mcp("initialize")
tools_resp = mcp("tools/list")
mcp_tools = tools_resp["result"]["tools"]

# ── Config ────────────────────────────────────────────────────────────────────

import os
llm_config = {
    "config_list": [{"model": "gpt-4o", "api_key": os.environ.get("OPENAI_API_KEY", "")}],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t.get("inputSchema", {"type": "object", "properties": {}}),
            },
        }
        for t in mcp_tools
    ],
}

# ── Agents ────────────────────────────────────────────────────────────────────

memory_agent = autogen.AssistantAgent(
    name="MemoryAgent",
    system_message=(
        "You are a memory-augmented assistant. You have access to SULCUS — a persistent semantic memory system. "
        "Your workflow:\n"
        "1. Call build_context with the user's question to retrieve relevant memories.\n"
        "2. Use the context to give an informed answer.\n"
        "3. Call add_memory to persist important new information.\n"
        "4. Use memory_type appropriately: 'semantic' for facts, 'episodic' for events, "
        "'preference' for preferences, 'procedural' for instructions.\n"
        "Never say you don't have access to past information — always check memory first."
    ),
    llm_config=llm_config,
)

user_proxy = autogen.UserProxyAgent(
    name="User",
    human_input_mode="NEVER",
    max_consecutive_auto_reply=8,
    code_execution_config=False,
)

# ── Register SULCUS tools ─────────────────────────────────────────────────────

def make_tool_fn(tool_name: str):
    def fn(**kwargs) -> str:
        clean = {k: v for k, v in kwargs.items() if v is not None}
        result = mcp("tools/call", {"name": tool_name, "arguments": clean})
        inner = result.get("result", {})
        if "content" in inner and isinstance(inner["content"], list):
            return inner["content"][0].get("text", json.dumps(inner))
        return json.dumps(inner)
    fn.__name__ = tool_name
    return fn

for tool_def in mcp_tools:
    autogen.register_function(
        make_tool_fn(tool_def["name"]),
        caller=memory_agent,
        executor=user_proxy,
        name=tool_def["name"],
        description=tool_def["description"],
    )

# ── Demo ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== Seeding memories ===")
    for content in [
        "The onboarding process for new engineers takes 2 weeks. Week 1: codebase tour + setup. Week 2: first PR.",
        "Our primary customers are mid-size SaaS companies with 50-500 engineers.",
        "The team uses linear.app for project management and GitHub for code review.",
        "Current sprints are 2 weeks long. We do planning on Monday and retro on Friday.",
    ]:
        mcp("tools/call", {"name": "add_memory", "arguments": {"content": content}})

    print("\n=== AutoGen Multi-Agent Conversation ===")
    user_proxy.initiate_chat(
        memory_agent,
        message="I'm a new engineer joining the team. What should I know about how the team works?",
    )

    mcp("tools/call", {"name": "dispatch_background_task", "arguments": {"task": "full_maintenance"}})
    proc.terminate()
