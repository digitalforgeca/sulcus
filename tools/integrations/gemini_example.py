#!/usr/bin/env python3
"""
SULCUS × Google Gemini — MCP tool connector example.

Requirements:
    pip install google-genai

Usage:
    export GEMINI_API_KEY=...
    cargo build -p sulcus
    python tools/integrations/gemini_example.py
"""

import json
import subprocess
import sys
from pathlib import Path

from google import genai
from google.genai import types

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
    line = proc.stdout.readline()
    if not line:
        raise RuntimeError("sulcus closed stdout")
    return json.loads(line)


def mcp_call_tool(name: str, arguments: dict) -> str:
    resp = mcp("tools/call", {"name": name, "arguments": arguments})
    inner = resp.get("result", {})
    if "content" in inner and isinstance(inner["content"], list) and inner["content"]:
        return inner["content"][0].get("text", json.dumps(inner))
    return json.dumps(inner)


def build_gemini_tools() -> list[types.Tool]:
    tools_resp = mcp("tools/list")
    mcp_tools = tools_resp["result"]["tools"]

    declarations: list[types.FunctionDeclaration] = []
    for t in mcp_tools:
        declarations.append(
            types.FunctionDeclaration(
                name=t["name"],
                description=t.get("description", ""),
                parameters=t.get("inputSchema", {"type": "object", "properties": {}}),
            )
        )

    return [types.Tool(function_declarations=declarations)]


def run_agent(user_prompt: str, model: str = "gemini-2.0-flash", max_steps: int = 8) -> str:
    client = genai.Client()

    history_parts: list[types.Part] = [types.Part.from_text(text=user_prompt)]

    system_instruction = (
        "You are a helpful assistant with access to SULCUS persistent memory tools. "
        "Use build_context, query_memory, or active_index before answering factual questions. "
        "Use record_memory to save durable facts from the exchange."
    )

    tools = build_gemini_tools()

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
            print(f"[step {step + 1}] tool calls={len(function_calls)}")
            for call in function_calls:
                args = dict(call.args or {})
                print(f"  → {call.name}({json.dumps(args, ensure_ascii=False)[:120]}…)")
                tool_text = mcp_call_tool(call.name, args)
                print(f"     ← {tool_text[:120]}")
                history_parts.append(types.Part.from_function_response(name=call.name, response={"result": tool_text}))
            continue

        final_text = "\n".join(text_parts).strip()
        if final_text:
            return final_text

    return "[agent loop ended without final answer]"


if __name__ == "__main__":
    try:
        mcp("initialize")

        print("=== Seeding memory ===")
        mcp_call_tool(
            "record_memory",
            {
                "content": "SULCUS server sync is rate limited to 100 syncs/minute per organization.",
                "fold_name": "default",
            },
        )
        mcp_call_tool(
            "record_memory",
            {
                "content": "SULCUS keeps hot pointers in active_index and pages raw content on demand.",
                "fold_name": "default",
            },
        )

        print("=== Gemini conversation ===")
        answer = run_agent("What do you know about SULCUS memory behavior and sync constraints?")
        print("\n[final answer]")
        print(answer)

        mcp_call_tool("dispatch_background_task", {"task": "full_maintenance"})
        print("\n[done]")
    finally:
        proc.terminate()
