#!/usr/bin/env python3
"""
SULCUS × Anthropic Claude — Full integration example.

Requirements:
    pip install anthropic

Usage:
    # Build SULCUS first
    cargo build -p sulcus-local

    # Run this script
    python tools/integrations/anthropic_example.py
"""

import json
import subprocess
import sys
from pathlib import Path

import anthropic

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
    line = proc.stdout.readline()
    return json.loads(line)

# ── Boot SULCUS ───────────────────────────────────────────────────────────────

mcp("initialize")
tools_resp = mcp("tools/list")

# Convert MCP tools → Anthropic format
anthropic_tools = [
    {
        "name": t["name"],
        "description": t["description"],
        "input_schema": t.get("inputSchema", {"type": "object", "properties": {}}),
    }
    for t in tools_resp["result"]["tools"]
]

print(f"[sulcus] Loaded {len(anthropic_tools)} tools")

# ── Agentic loop ──────────────────────────────────────────────────────────────

client = anthropic.Anthropic()

def run_agent(user_message: str, model: str = "claude-opus-4-5", max_steps: int = 10) -> str:
    """Run a Claude agent with full access to SULCUS memory tools."""
    messages = [{"role": "user", "content": user_message}]

    system = (
        "You are a helpful assistant with access to a persistent semantic memory system called SULCUS. "
        "Before answering any question, call search_memory or build_context to retrieve relevant memories. "
        "After generating an answer, call add_memory to record the key facts from this exchange. "
        "Use memory_type='semantic' for facts, 'episodic' for events, 'preference' for user preferences, "
        "and 'procedural' for step-by-step instructions."
    )

    for step in range(max_steps):
        resp = client.messages.create(
            model=model,
            max_tokens=4096,
            system=system,
            tools=anthropic_tools,
            messages=messages,
        )

        print(f"\n[step {step + 1}] stop_reason={resp.stop_reason}")

        if resp.stop_reason == "tool_use":
            # Collect all tool calls and results in this turn
            assistant_content = resp.content
            tool_results = []

            for block in resp.content:
                if block.type == "tool_use":
                    print(f"  → {block.name}({json.dumps(block.input, ensure_ascii=False)[:120]}…)")
                    result = mcp("tools/call", {"name": block.name, "arguments": block.input})
                    inner = result.get("result", {})
                    if "content" in inner and isinstance(inner["content"], list):
                        # MCP wraps result in content array
                        text_result = inner["content"][0].get("text", json.dumps(inner))
                    else:
                        text_result = json.dumps(inner)
                    print(f"     ← {text_result[:120]}")
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": text_result,
                    })

            messages.append({"role": "assistant", "content": assistant_content})
            messages.append({"role": "user", "content": tool_results})

        elif resp.stop_reason == "end_turn":
            final = "".join(b.text for b in resp.content if hasattr(b, "text"))
            return final
        else:
            break

    return "[agent loop ended without final answer]"


# ── Demo ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Pre-populate some memories
    print("\n=== Seeding memories ===")
    mcp("tools/call", {"name": "add_memory", "arguments": {
        "content": "The authentication module uses JWT tokens with a 24-hour expiry. Refresh tokens last 30 days."
    }})
    mcp("tools/call", {"name": "add_memory", "arguments": {
        "content": "Redis is our caching layer. We run Redis 7.2 in cluster mode with 3 primary shards."
    }})
    mcp("tools/call", {"name": "add_memory", "arguments": {
        "content": "The API rate limit is 1000 requests per minute per API key."
    }})

    # Ask a question that requires memory retrieval
    print("\n=== Agent conversation ===")
    answer = run_agent("What do you know about our authentication setup and API limits?")
    print(f"\n[final answer]\n{answer}")

    # Run maintenance
    mcp("tools/call", {"name": "dispatch_background_task", "arguments": {"task": "full_maintenance"}})

    proc.terminate()
    print("\n[done]")
