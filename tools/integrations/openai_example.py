#!/usr/bin/env python3
"""
SULCUS × OpenAI GPT — Full integration example.

Requirements:
    pip install openai

Usage:
    export OPENAI_API_KEY=sk-...
    cargo build -p sulcus
    python tools/integrations/openai_example.py
"""

import json
import subprocess
import sys
from pathlib import Path

from openai import OpenAI

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

# Convert MCP tools → OpenAI function format
openai_tools = [
    {
        "type": "function",
        "function": {
            "name": t["name"],
            "description": t["description"],
            "parameters": t.get("inputSchema", {"type": "object", "properties": {}}),
        },
    }
    for t in tools_resp["result"]["tools"]
]

print(f"[sulcus] Loaded {len(openai_tools)} tools")

# ── Agentic loop ──────────────────────────────────────────────────────────────

client = OpenAI()

def run_agent(user_message: str, model: str = "gpt-4o", max_steps: int = 10) -> str:
    """Run a GPT agent with full access to SULCUS memory tools."""
    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful assistant with access to a persistent semantic memory system called SULCUS. "
                "Before answering questions, call search_memory or build_context to retrieve relevant context. "
                "After answering, call add_memory to persist key facts."
            ),
        },
        {"role": "user", "content": user_message},
    ]

    for step in range(max_steps):
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=openai_tools,
            tool_choice="auto",
            parallel_tool_calls=True,
        )
        msg = resp.choices[0].message
        print(f"\n[step {step + 1}] finish_reason={resp.choices[0].finish_reason}")

        if msg.tool_calls:
            messages.append(msg)
            for tc in msg.tool_calls:
                args = json.loads(tc.function.arguments)
                print(f"  → {tc.function.name}({json.dumps(args, ensure_ascii=False)[:120]}…)")
                result = mcp("tools/call", {"name": tc.function.name, "arguments": args})
                inner = result.get("result", {})
                if "content" in inner and isinstance(inner["content"], list):
                    text_result = inner["content"][0].get("text", json.dumps(inner))
                else:
                    text_result = json.dumps(inner)
                print(f"     ← {text_result[:120]}")
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": text_result,
                })
        else:
            return msg.content or ""

    return "[agent loop ended without final answer]"


# ── Demo ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== Seeding memories ===")
    mcp("tools/call", {"name": "add_memory", "arguments": {
        "content": "The authentication module uses JWT tokens with a 24-hour expiry."
    }})
    mcp("tools/call", {"name": "add_memory", "arguments": {
        "content": "PostgreSQL 16 is the primary database. We use connection pooling via PgBouncer."
    }})
    mcp("tools/call", {"name": "add_memory", "arguments": {
        "content": "Deployment pipeline: GitHub Actions → Docker build → Kubernetes rolling update."
    }})

    print("\n=== Agent conversation ===")
    answer = run_agent("Summarise everything you know about our infrastructure and deployment process.")
    print(f"\n[final answer]\n{answer}")

    # Background maintenance
    mcp("tools/call", {"name": "dispatch_background_task", "arguments": {"task": "full_maintenance"}})

    proc.terminate()
    print("\n[done]")
