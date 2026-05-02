#!/usr/bin/env python3
"""
SULCUS × LlamaIndex — Full integration example.

Requirements:
    pip install llama-index llama-index-llms-openai

Usage:
    export OPENAI_API_KEY=sk-...
    cargo build -p sulcus
    python tools/integrations/llamaindex_example.py
"""

import json
import subprocess
import sys
from pathlib import Path

from llama_index.core.agent import ReActAgent
from llama_index.core.tools import FunctionTool
from llama_index.llms.openai import OpenAI

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

# ── Convert MCP tools → LlamaIndex FunctionTools ─────────────────────────────

def make_llama_tool(tool_def: dict) -> FunctionTool:
    name = tool_def["name"]
    description = tool_def["description"]
    props = tool_def.get("inputSchema", {}).get("properties", {})

    # Build a type-annotated function signature
    # LlamaIndex uses the function's docstring and signature for tool description
    param_docs = "\n        ".join(f"{k}: {v.get('description', k)}" for k, v in props.items())

    def fn(**kwargs: str) -> str:
        f"""
        {description}

        Parameters
        ----------
        {param_docs}
        """
        clean = {k: v for k, v in kwargs.items() if v is not None}
        result = mcp("tools/call", {"name": name, "arguments": clean})
        inner = result.get("result", {})
        if "content" in inner and isinstance(inner["content"], list):
            return inner["content"][0].get("text", json.dumps(inner))
        return json.dumps(inner)

    fn.__name__ = name
    fn.__doc__ = description

    return FunctionTool.from_defaults(
        fn=fn,
        name=name,
        description=description,
    )

sulcus_tools = [make_llama_tool(t) for t in tools_resp["result"]["tools"]]
print(f"[sulcus] Loaded {len(sulcus_tools)} LlamaIndex tools")

# ── Agent ─────────────────────────────────────────────────────────────────────

llm = OpenAI(model="gpt-4o", temperature=0)

agent = ReActAgent.from_tools(
    sulcus_tools,
    llm=llm,
    verbose=True,
    system_prompt=(
        "You are a helpful assistant with a persistent semantic memory (SULCUS). "
        "Always search memory before answering and add important facts after responding."
    ),
    max_iterations=10,
)

# ── Demo ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== Seeding memories ===")
    for content in [
        "The main product is an AI-powered code review tool called CodeLens.",
        "CodeLens integrates with GitHub, GitLab, and Bitbucket.",
        "Current user count: 12,000 monthly active users as of Q1 2026.",
        "Tech stack: Rust backend, React frontend, PostgreSQL database.",
    ]:
        mcp("tools/call", {"name": "add_memory", "arguments": {"content": content}})

    print("\n=== LlamaIndex ReAct Agent ===")
    response = agent.chat("Tell me about CodeLens — what is it, who uses it, and what does it integrate with?")
    print(f"\n[response]\n{response}")

    mcp("tools/call", {"name": "dispatch_background_task", "arguments": {"task": "full_maintenance"}})
    proc.terminate()
