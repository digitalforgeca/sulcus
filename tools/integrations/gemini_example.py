#!/usr/bin/env python3
"""
SULCUS × Google Gemini — integration example with auto-recall.

Demonstrates two approaches:
1. **MCP sidecar** (local binary) — for self-hosted SULCUS instances
2. **REST API** (cloud) — for SULCUS Cloud (api.sulcus.ca), recommended

Both approaches include:
- Auto-recall context injection per conversation turn
- Tool-calling loop with SULCUS memory tools
- Automatic memory capture of significant exchanges

Requirements:
    pip install google-genai

MCP sidecar usage:
    cargo build -p sulcus
    python tools/integrations/gemini_example.py --mode mcp

REST API usage (recommended):
    export SULCUS_API_KEY=sk-...
    export SULCUS_BASE_URL=https://api.sulcus.ca  # default
    python tools/integrations/gemini_example.py --mode rest
    python tools/integrations/gemini_example.py              # defaults to rest
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

from google import genai
from google.genai import types

# ---------------------------------------------------------------------------
# MCP sidecar helpers (approach 1 — local binary)
# ---------------------------------------------------------------------------

SULCUS_BIN = Path(__file__).parent.parent.parent / "target" / "debug" / "sulcus"

_proc = None
_req_id = 0


def _start_mcp():
    global _proc
    if not SULCUS_BIN.exists():
        sys.exit(f"Binary not found at {SULCUS_BIN}. Run: cargo build -p sulcus")
    _proc = subprocess.Popen(
        [str(SULCUS_BIN), "serve"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        bufsize=1,
    )


def _mcp(method: str, params: dict | None = None) -> dict:
    global _req_id
    _req_id += 1
    req = json.dumps({"jsonrpc": "2.0", "id": _req_id, "method": method, "params": params or {}})
    _proc.stdin.write(req + "\n")
    _proc.stdin.flush()
    line = _proc.stdout.readline()
    if not line:
        raise RuntimeError("sulcus closed stdout")
    return json.loads(line)


def _mcp_call_tool(name: str, arguments: dict) -> str:
    resp = _mcp("tools/call", {"name": name, "arguments": arguments})
    inner = resp.get("result", {})
    if "content" in inner and isinstance(inner["content"], list) and inner["content"]:
        return inner["content"][0].get("text", json.dumps(inner))
    return json.dumps(inner)


def _build_mcp_tools() -> list[types.Tool]:
    tools_resp = _mcp("tools/list")
    mcp_tools = tools_resp["result"]["tools"]
    declarations = []
    for t in mcp_tools:
        declarations.append(
            types.FunctionDeclaration(
                name=t["name"],
                description=t.get("description", ""),
                parameters=t.get("inputSchema", {"type": "object", "properties": {}}),
            )
        )
    return [types.Tool(function_declarations=declarations)]


# ---------------------------------------------------------------------------
# REST API helpers (approach 2 — cloud, recommended)
# ---------------------------------------------------------------------------

# Import the shared handler from sulcus-core-tools package.
# The directory uses hyphens on disk, which Python can't import directly.
# We create a symlink with underscores so standard package imports work.
import importlib
_packages_dir = Path(__file__).parent.parent.parent / "packages"
_src = _packages_dir / "sulcus-core-tools"
_dst = _packages_dir / "sulcus_core_tools"
if _src.exists() and not _dst.exists():
    _dst.symlink_to("sulcus-core-tools")  # relative to packages/
if str(_packages_dir) not in sys.path:
    sys.path.insert(0, str(_packages_dir))

from sulcus_core_tools.handler import dispatch, sulcus_auto_recall, sulcus_auto_capture, sulcus_status  # noqa: E402
from sulcus_core_tools.formatters.gemini import format_tools  # noqa: E402


def _build_rest_tools() -> list[types.Tool]:
    """Build Gemini FunctionDeclarations from the canonical tool definitions."""
    declarations = []
    for tool_dict in format_tools():
        declarations.append(types.FunctionDeclaration(**tool_dict))
    return [types.Tool(function_declarations=declarations)]


def _rest_call_tool(name: str, arguments: dict) -> str:
    """Dispatch a tool call through the REST handler."""
    try:
        result = dispatch(name, arguments)
        return json.dumps(result, default=str, ensure_ascii=False)
    except Exception as exc:
        return json.dumps({"error": str(exc)})


# ---------------------------------------------------------------------------
# Gemini agent loop (shared by both modes)
# ---------------------------------------------------------------------------

def run_agent(
    user_prompt: str,
    *,
    mode: str = "rest",
    model: str = "gemini-2.0-flash",
    max_steps: int = 8,
    auto_recall: bool = True,
    recall_budget: int = 4000,
) -> str:
    """Run a Gemini conversation turn with SULCUS memory integration.

    Args:
        user_prompt: The user's message.
        mode: "mcp" for local sidecar, "rest" for cloud API.
        model: Gemini model name.
        max_steps: Maximum tool-calling loop iterations.
        auto_recall: Inject recalled context into system prompt (recommended).
        recall_budget: Token budget for auto-recall context.

    Returns:
        The final text response from Gemini.
    """
    client = genai.Client()

    # --- Auto-recall: inject relevant context before the LLM sees the prompt ---
    recall_context = ""
    if auto_recall:
        try:
            if mode == "rest":
                recall = sulcus_auto_recall(user_prompt, token_budget=recall_budget)
                recall_context = recall.get("context", "")
                meta = f"({recall['selected']}/{recall['total_candidates']} memories, ~{recall['tokens_used_estimate']} tokens"
                if recall.get("graph_hop_count", 0) > 0:
                    meta += f", {recall['graph_hop_count']} from graph"
                meta += ")"
                print(f"  [auto-recall] {meta}")
            else:
                # MCP mode: use build_context tool
                resp = _mcp_call_tool("build_context", {"query": user_prompt, "token_budget": recall_budget})
                recall_context = resp
        except Exception as exc:
            print(f"  [auto-recall] failed: {exc}")

    # --- Build system instruction with recalled context ---
    system_parts = [
        "You are a helpful assistant with access to SULCUS persistent memory tools.",
        "Use sulcus_search or sulcus_auto_recall before answering factual questions about past context.",
        "Use sulcus_remember to save important decisions, facts, or learnings from this exchange.",
    ]
    if recall_context and recall_context != "No relevant memories found.":
        system_parts.append(
            f"\n<sulcus-context>\n"
            f"The following is recalled context from SULCUS persistent memory. "
            f"Reference it only when relevant.\n\n"
            f"{recall_context}\n"
            f"</sulcus-context>"
        )
    system_instruction = "\n".join(system_parts)

    # --- Build tools ---
    tools = _build_rest_tools() if mode == "rest" else _build_mcp_tools()
    call_tool = _rest_call_tool if mode == "rest" else _mcp_call_tool

    # --- Conversation loop ---
    history_parts = [types.Part.from_text(text=user_prompt)]

    for step in range(max_steps):
        resp = client.models.generate_content(
            model=model,
            contents=history_parts,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                tools=tools,
                temperature=0.2,
            ),
        )

        parts = resp.candidates[0].content.parts if resp.candidates else []
        function_calls = [p.function_call for p in parts if getattr(p, "function_call", None)]
        text_parts = [p.text for p in parts if getattr(p, "text", None)]

        if function_calls:
            print(f"  [step {step + 1}] tool calls={len(function_calls)}")
            for call in function_calls:
                args = dict(call.args or {})
                print(f"    → {call.name}({json.dumps(args, ensure_ascii=False)[:120]}…)")
                tool_text = call_tool(call.name, args)
                print(f"      ← {tool_text[:120]}")
                history_parts.append(
                    types.Part.from_function_response(name=call.name, response={"result": tool_text})
                )
            continue

        final_text = "\n".join(text_parts).strip()
        if final_text:
            # Auto-capture: fire-and-forget capture of significant assistant output
            if mode == "rest" and len(final_text) > 50:
                try:
                    cap = sulcus_auto_capture(final_text, source="gemini-agent")
                    if cap.get("captured"):
                        print(f"  [auto-capture] stored as {cap.get('memory_type', 'unknown')} "
                              f"(confidence: {cap.get('quality_confidence', 0):.2f})")
                except Exception:
                    pass  # fire-and-forget
            return final_text

    return "[agent loop ended without final answer]"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="SULCUS × Gemini integration example")
    parser.add_argument("--mode", choices=["mcp", "rest"], default="rest",
                        help="mcp = local binary sidecar, rest = cloud API (default)")
    parser.add_argument("--model", default="gemini-2.0-flash", help="Gemini model name")
    parser.add_argument("--no-auto-recall", action="store_true",
                        help="Disable auto-recall context injection")
    args = parser.parse_args()

    try:
        if args.mode == "mcp":
            print("=== Starting MCP sidecar ===")
            _start_mcp()
            _mcp("initialize")
        else:
            print("=== Using REST API ===")
            status = sulcus_status()
            ns = status.get("namespace", "unknown")
            ver = status.get("version", "unknown")
            print(f"  Connected: namespace={ns}, version={ver}")

        # Seed some memories for demonstration
        print("\n=== Seeding example memories ===")
        if args.mode == "rest":
            dispatch("sulcus_remember", {
                "content": "SULCUS server sync is rate limited to 100 syncs/minute per organization.",
                "memory_type": "semantic",
            })
            dispatch("sulcus_remember", {
                "content": "SULCUS keeps hot pointers in active_index and pages raw content on demand.",
                "memory_type": "semantic",
            })
        else:
            _mcp_call_tool("record_memory", {
                "content": "SULCUS server sync is rate limited to 100 syncs/minute per organization.",
                "fold_name": "default",
            })
            _mcp_call_tool("record_memory", {
                "content": "SULCUS keeps hot pointers in active_index and pages raw content on demand.",
                "fold_name": "default",
            })
        print("  Stored 2 example memories")

        # Run a conversation turn
        print("\n=== Gemini conversation ===")
        answer = run_agent(
            "What do you know about SULCUS memory behavior and sync constraints?",
            mode=args.mode,
            model=args.model,
            auto_recall=not args.no_auto_recall,
        )
        print(f"\n[final answer]\n{answer}")

        # Follow-up (demonstrates topic-stable recall if same topic)
        print("\n=== Follow-up question ===")
        answer2 = run_agent(
            "Can you tell me more about the rate limiting specifics?",
            mode=args.mode,
            model=args.model,
            auto_recall=not args.no_auto_recall,
        )
        print(f"\n[final answer]\n{answer2}")

    finally:
        if _proc:
            _proc.terminate()
    print("\n[done]")


if __name__ == "__main__":
    main()
