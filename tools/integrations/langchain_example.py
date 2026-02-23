#!/usr/bin/env python3
"""
SULCUS × LangChain — Full integration example.

Requirements:
    pip install langchain langchain-openai pydantic

Usage:
    export OPENAI_API_KEY=sk-...
    cargo build -p sulcus-local
    python tools/integrations/langchain_example.py
"""

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.tools import StructuredTool
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, create_model, Field

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


# ── Convert MCP tools → LangChain StructuredTools ────────────────────────────

JSON_TYPE_MAP = {
    "string": (str, None),
    "integer": (int, None),
    "number": (float, None),
    "boolean": (bool, None),
    "array": (list, None),
    "object": (dict, None),
}

def schema_to_pydantic(name: str, schema: dict) -> type[BaseModel]:
    """Convert a JSON Schema object to a Pydantic BaseModel class."""
    props = schema.get("properties", {})
    required = set(schema.get("required", []))
    fields: dict[str, Any] = {}
    for field_name, field_schema in props.items():
        json_type = field_schema.get("type", "string")
        py_type, default = JSON_TYPE_MAP.get(json_type, (str, None))
        desc = field_schema.get("description", "")
        if field_name in required:
            fields[field_name] = (py_type, Field(..., description=desc))
        else:
            fields[field_name] = (py_type | None, Field(default=None, description=desc))
    return create_model(f"{name}Args", **fields)

def make_langchain_tool(tool_def: dict) -> StructuredTool:
    tool_name = tool_def["name"]
    description = tool_def["description"]
    input_schema = tool_def.get("inputSchema", {"type": "object", "properties": {}})

    ArgsModel = schema_to_pydantic(tool_name, input_schema)

    def run(**kwargs: Any) -> str:
        # Strip None values before sending to MCP
        clean_args = {k: v for k, v in kwargs.items() if v is not None}
        result = mcp("tools/call", {"name": tool_name, "arguments": clean_args})
        inner = result.get("result", {})
        if "content" in inner and isinstance(inner["content"], list):
            return inner["content"][0].get("text", json.dumps(inner))
        return json.dumps(inner)

    return StructuredTool.from_function(
        func=run,
        name=tool_name,
        description=description,
        args_schema=ArgsModel,
    )

sulcus_tools = [make_langchain_tool(t) for t in tools_resp["result"]["tools"]]
print(f"[sulcus] Loaded {len(sulcus_tools)} LangChain tools")

# ── Agent ─────────────────────────────────────────────────────────────────────

llm = ChatOpenAI(model="gpt-4o", temperature=0)

prompt = ChatPromptTemplate.from_messages([
    ("system",
     "You are a helpful assistant with access to a persistent semantic memory system called SULCUS.\n"
     "Workflow:\n"
     "1. Before answering, call build_context with the user's message to retrieve relevant memories.\n"
     "2. Insert the returned context block into your reasoning.\n"
     "3. Answer the user.\n"
     "4. Call add_memory to persist important new facts from this turn.\n"
     "5. At the end of the session, call dispatch_background_task with task='full_maintenance'."
    ),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])

agent = create_tool_calling_agent(llm, sulcus_tools, prompt)
executor = AgentExecutor(agent=agent, tools=sulcus_tools, verbose=True, max_iterations=10)

# ── Demo ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== Seeding memories ===")
    mcp("tools/call", {"name": "add_memory", "arguments": {"content": "We use Kubernetes 1.29 on GKE for production workloads."}})
    mcp("tools/call", {"name": "add_memory", "arguments": {"content": "Terraform manages all cloud infrastructure. State is stored in GCS."}})
    mcp("tools/call", {"name": "add_memory", "arguments": {"content": "SLA target: 99.9% uptime. Incident response: PagerDuty escalation in 5 minutes."}})

    print("\n=== LangChain Agent ===")
    result = executor.invoke({"input": "What do you know about our infrastructure? Give me a concise summary."})
    print(f"\n[output]\n{result['output']}")

    proc.terminate()
