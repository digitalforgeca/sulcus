#!/usr/bin/env python3
"""
SULCUS × Ollama — 100% local, zero cloud dependencies.

Requirements:
    pip install ollama
    ollama pull llama3.1   # or qwen2.5, mistral-nemo, etc.

Usage:
    # Start Ollama daemon first: ollama serve
    cargo build -p sulcus-local
    python tools/integrations/ollama_example.py
"""

import json
import subprocess
import sys
from pathlib import Path

import ollama

# ── SULCUS sidecar ────────────────────────────────────────────────────────────

SULCUS_BIN = Path(__file__).parent.parent.parent / "target" / "debug" / "sulcus-local"
if not SULCUS_BIN.exists():
    sys.exit(f"Binary not found at {SULCUS_BIN}. Run: cargo build -p sulcus-local")

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

# Convert MCP tools → Ollama tool format (same as OpenAI)
ollama_tools = [
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

print(f"[sulcus] Loaded {len(ollama_tools)} tools — running fully local 🔒")

# ── Agentic loop ──────────────────────────────────────────────────────────────

MODEL = "llama3.1"  # Change to qwen2.5, mistral-nemo, etc.

def run_agent(user_message: str, max_steps: int = 8) -> str:
    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful assistant with a persistent memory system (SULCUS). "
                "Search memory before answering questions. Store new facts after answering."
            ),
        },
        {"role": "user", "content": user_message},
    ]

    for step in range(max_steps):
        resp = ollama.chat(model=MODEL, messages=messages, tools=ollama_tools)
        msg = resp["message"]
        print(f"\n[step {step + 1}]")

        if msg.get("tool_calls"):
            messages.append(msg)
            for tc in msg["tool_calls"]:
                fn = tc["function"]
                name = fn["name"]
                args = fn.get("arguments", {})
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except json.JSONDecodeError:
                        args = {}
                print(f"  → {name}({json.dumps(args, ensure_ascii=False)[:120]}…)")
                result = mcp("tools/call", {"name": name, "arguments": args})
                inner = result.get("result", {})
                if "content" in inner and isinstance(inner["content"], list):
                    text_result = inner["content"][0].get("text", json.dumps(inner))
                else:
                    text_result = json.dumps(inner)
                print(f"     ← {text_result[:120]}")
                messages.append({
                    "role": "tool",
                    "content": text_result,
                })
        else:
            return msg.get("content", "")

    return "[agent loop ended]"


# ── Demo ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== Seeding memories (local PGlite/Postgres-compatible, no cloud) ===")
    for content in [
        "Our development environment uses Docker Compose for local services.",
        "The team follows trunk-based development. All PRs merge to main within 24 hours.",
        "Code freeze starts 5 days before each release.",
    ]:
        mcp("tools/call", {"name": "add_memory", "arguments": {"content": content}})
        print(".", end="", flush=True)
    print()

    print(f"\n=== {MODEL} via Ollama (fully local) ===")
    answer = run_agent("How does our team handle code releases and development workflow?")
    print(f"\n[final answer]\n{answer}")

    mcp("tools/call", {"name": "dispatch_background_task", "arguments": {"task": "tick"}})
    proc.terminate()
    print("\n[done] — no data left the machine 🔒")
