# Sulcus — LLM Integration Guide

Sulcus implements the **Model Context Protocol (MCP)** — the universal agent tool standard. Any LLM framework that can call tools or functions can integrate with Sulcus in minutes.

## Dedicated Packages

For the fastest integration, use our dedicated packages:

| Framework | Package | Install |
|---|---|---|
| **Python SDK** | `sulcus` | `pip install sulcus` |
| **Node.js SDK** | `sulcus` | `npm install sulcus` |
| **LangChain** | `sulcus-langchain` | `pip install sulcus-langchain` |
| **LlamaIndex** | `sulcus-llamaindex` | `pip install sulcus-llamaindex` |
| **Vercel AI SDK** | `sulcus-vercel-ai` | `npm install sulcus-vercel-ai` |
| **CLI** | `sulcus-cli` | `npm install -g sulcus-cli` |
| **OpenAI tools** | — | Copy [`integrations/openai-tools/tools.json`](integrations/openai-tools/tools.json) |
| **Anthropic tools** | — | Copy [`integrations/anthropic-tools/tools.json`](integrations/anthropic-tools/tools.json) |
| **OpenClaw** | `openclaw-sulcus` | `openclaw plugins install @sulcus/memory-sulcus` |

Source code for all integrations lives in the [`integrations/`](integrations/) directory.

---

## Table of Contents

1. [How it works (30 seconds)](#how-it-works)
2. [Universal tool manifest](#universal-tool-manifest)
3. [Claude Desktop (1-click)](#1-claude-desktop-1-click)
4. [Claude via Anthropic SDK](#2-claude-via-anthropic-sdk-python)
5. [OpenAI GPT (function calling)](#3-openai-gpt-function-calling-python)
6. [Google Gemini](#4-google-gemini-python)
7. [LangChain](#5-langchain-python)
8. [LlamaIndex](#6-llamaindex-python)
9. [AutoGen / AG2](#7-autogen--ag2-python)
10. [Vercel AI SDK](#8-vercel-ai-sdk-typescript)
11. [Ollama / local models](#9-ollama--local-models)
12. [MCP over HTTP/SSE](#10-mcp-over-httpsse-server-mode)
13. [Raw MCP (any language)](#11-raw-mcp-any-language)
14. [Tool reference](#tool-reference)

---

## How it works

```
Your LLM  ──tool_call──▶  sulcus-local  ──SQL──▶  PGlite/Postgres-compatible backend (local)
                ◀──result─────────────────────────────────────────
```

SULCUS runs as a sidecar process. Your LLM calls memory tools; SULCUS persists and retrieves from a real PostgreSQL-compatible database with vector search.

**Two transport modes:**
| Mode | Use when |
|---|---|
| **MCP Stdio** | Local sidecar (Claude Desktop, any subprocess-based framework) |
| **MCP SSE / HTTP** | Remote server, web agents, multi-tenant teams |

---

## Universal tool manifest

`integrations/openai-tools/tools.json` contains all SULCUS tools in OpenAI function-calling format. Every major LLM SDK can consume this format directly.

```bash
# Load the manifest in Python
import json
tools = json.load(open("integrations/openai-tools/tools.json"))
```

---

## 1. Claude Desktop (1-click)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "cargo",
      "args": [
        "run",
        "--manifest-path",
        "/path/to/sulcus/Cargo.toml",
        "-p",
        "sulcus-local",
        "--",
        "serve"
      ],
      "env": {
        "SULCUS_DATABASE_URL": "postgres://sulcus:sulcus@127.0.0.1:5433/sulcus_test"
      }
    }
  }
}
```

Or if you have the binary installed:

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "/usr/local/bin/sulcus-local",
      "args": ["serve"]
    }
  }
}
```

Claude will discover all SULCUS tools automatically via `initialize` + `tools/list`. See `tools/manifests/claude_mcp.json` for the config template.

---

## 2. Claude via Anthropic SDK (Python)

```python
import anthropic
import subprocess, threading, json

# --- start sulcus sidecar ---
proc = subprocess.Popen(
    ["cargo", "run", "-p", "sulcus-local", "--", "serve"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    text=True,
    bufsize=1,
)

def mcp(method, params=None):
    req = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
    proc.stdin.write(req + "\n")
    proc.stdin.flush()
    return json.loads(proc.stdout.readline())

# Initialize
mcp("initialize")
tools_resp = mcp("tools/list")

# Convert MCP tool list → Anthropic tool format
anthropic_tools = [
    {
        "name": t["name"],
        "description": t["description"],
        "input_schema": t["inputSchema"],
    }
    for t in tools_resp["result"]["tools"]
]

client = anthropic.Anthropic()

def run_agent(user_message: str):
    messages = [{"role": "user", "content": user_message}]

    while True:
        resp = client.messages.create(
            model="claude-opus-4-5",
            max_tokens=1024,
            tools=anthropic_tools,
            messages=messages,
        )

        if resp.stop_reason == "tool_use":
            tool_results = []
            for block in resp.content:
                if block.type == "tool_use":
                    result = mcp("tools/call", {"name": block.name, "arguments": block.input})
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result.get("result", {})),
                    })
            messages.append({"role": "assistant", "content": resp.content})
            messages.append({"role": "user", "content": tool_results})
        else:
            return resp.content[0].text

answer = run_agent("What do you remember about the auth module?")
print(answer)
```

See `integrations/anthropic-tools/example.py` for the full example.

---

## 3. OpenAI GPT (function calling, Python)

```python
from openai import OpenAI
import json, subprocess

proc = subprocess.Popen(
    ["./target/debug/sulcus-local", "serve"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1,
)

def mcp(method, params=None):
    req = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
    proc.stdin.write(req + "\n"); proc.stdin.flush()
    return json.loads(proc.stdout.readline())

mcp("initialize")
tools_resp = mcp("tools/list")

# Convert MCP tools → OpenAI function format
openai_tools = [
    {"type": "function", "function": {
        "name": t["name"],
        "description": t["description"],
        "parameters": t["inputSchema"],
    }}
    for t in tools_resp["result"]["tools"]
]

client = OpenAI()
messages = [{"role": "user", "content": "Store the fact that Redis is our caching layer."}]

while True:
    resp = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=openai_tools,
        tool_choice="auto",
    )
    msg = resp.choices[0].message

    if msg.tool_calls:
        messages.append(msg)
        for tc in msg.tool_calls:
            result = mcp("tools/call", {"name": tc.function.name, "arguments": json.loads(tc.function.arguments)})
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": json.dumps(result.get("result", {})),
            })
    else:
        print(msg.content)
        break
```

See `integrations/openai-tools/example.py` for the full agentic loop.

---

## 4. Google Gemini (Python)

```python
import google.generativeai as genai
import json, subprocess

proc = subprocess.Popen(["./target/debug/sulcus-local", "serve"],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)

def mcp(method, params=None):
    req = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
    proc.stdin.write(req + "\n"); proc.stdin.flush()
    return json.loads(proc.stdout.readline())

mcp("initialize")
tools_resp = mcp("tools/list")

# Convert to Gemini function declarations
gemini_functions = [
    genai.protos.FunctionDeclaration(
        name=t["name"],
        description=t["description"],
        parameters=genai.protos.Schema(
            type=genai.protos.Type.OBJECT,
            properties={
                k: genai.protos.Schema(type=genai.protos.Type.STRING)
                for k in t.get("inputSchema", {}).get("properties", {})
            },
        ),
    )
    for t in tools_resp["result"]["tools"]
]

genai.configure(api_key="YOUR_API_KEY")
model = genai.GenerativeModel("gemini-1.5-pro", tools=[genai.protos.Tool(function_declarations=gemini_functions)])
chat = model.start_chat(enable_automatic_function_calling=False)

response = chat.send_message("Remember that the API rate limit is 1000 req/min.")
for part in response.parts:
    if fn := part.function_call:
        args = dict(fn.args)
        result = mcp("tools/call", {"name": fn.name, "arguments": args})
        response = chat.send_message(genai.protos.Part(
            function_response=genai.protos.FunctionResponse(
                name=fn.name, response={"result": result.get("result", {})}
            )
        ))
        print(response.text)
```

---

## 5. LangChain (Python)

```python
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.tools import StructuredTool
from langchain_core.prompts import ChatPromptTemplate
import json, subprocess

proc = subprocess.Popen(["./target/debug/sulcus-local", "serve"],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)

def mcp(method, params=None):
    req = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
    proc.stdin.write(req + "\n"); proc.stdin.flush()
    return json.loads(proc.stdout.readline())

mcp("initialize")
tools_resp = mcp("tools/list")

def make_tool(tool_def):
    name = tool_def["name"]
    description = tool_def["description"]
    schema = tool_def["inputSchema"]

    def run(**kwargs):
        result = mcp("tools/call", {"name": name, "arguments": kwargs})
        return json.dumps(result.get("result", {}))

    # Build a typed args schema from inputSchema
    from pydantic import BaseModel, create_model
    props = schema.get("properties", {})
    required = schema.get("required", [])
    fields = {
        k: (str, ...) if k in required else (str, None)
        for k in props
    }
    ArgsModel = create_model(f"{name}_args", **fields)

    return StructuredTool.from_function(
        func=run,
        name=name,
        description=description,
        args_schema=ArgsModel,
    )

sulcus_tools = [make_tool(t) for t in tools_resp["result"]["tools"]]

llm = ChatOpenAI(model="gpt-4o")
prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful assistant with access to a persistent memory system (SULCUS). Always record important facts and retrieve relevant memories before answering."),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])

agent = create_tool_calling_agent(llm, sulcus_tools, prompt)
executor = AgentExecutor(agent=agent, tools=sulcus_tools, verbose=True)
executor.invoke({"input": "What was the last deployment issue we discussed?"})
```

See `integrations/langchain/examples/basic_chain.py` for the complete runnable script.

---

## 6. LlamaIndex (Python)

```python
from llama_index.core.tools import FunctionTool
from llama_index.core.agent import ReActAgent
from llama_index.llms.openai import OpenAI
import json, subprocess

proc = subprocess.Popen(["./target/debug/sulcus-local", "serve"],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)

def mcp(method, params=None):
    req = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
    proc.stdin.write(req + "\n"); proc.stdin.flush()
    return json.loads(proc.stdout.readline())

mcp("initialize")
tools_resp = mcp("tools/list")

def make_llama_tool(tool_def):
    name = tool_def["name"]
    description = tool_def["description"]

    def fn(**kwargs) -> str:
        result = mcp("tools/call", {"name": name, "arguments": kwargs})
        return json.dumps(result.get("result", {}))

    fn.__name__ = name
    fn.__doc__ = description
    return FunctionTool.from_defaults(fn=fn, name=name, description=description)

sulcus_tools = [make_llama_tool(t) for t in tools_resp["result"]["tools"]]

llm = OpenAI(model="gpt-4o")
agent = ReActAgent.from_tools(sulcus_tools, llm=llm, verbose=True)
agent.chat("Search my memory for anything about database migrations.")
```

See `integrations/llamaindex/examples/rag_pipeline.py`.

---

## 7. AutoGen / AG2 (Python)

```python
import autogen
import json, subprocess

proc = subprocess.Popen(["./target/debug/sulcus-local", "serve"],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)

def mcp(method, params=None):
    req = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
    proc.stdin.write(req + "\n"); proc.stdin.flush()
    return json.loads(proc.stdout.readline())

mcp("initialize")
tools_resp = mcp("tools/list")

config = {"config_list": [{"model": "gpt-4o", "api_key": "YOUR_KEY"}]}

assistant = autogen.AssistantAgent(
    name="SulcusAgent",
    system_message="You have access to a persistent memory system. Use search_memory before answering. Use record_memory to record important facts.",
    llm_config={**config, "tools": [
        {"type": "function", "function": {
            "name": t["name"],
            "description": t["description"],
            "parameters": t["inputSchema"],
        }}
        for t in tools_resp["result"]["tools"]
    ]},
)

user_proxy = autogen.UserProxyAgent(
    name="User",
    human_input_mode="NEVER",
    max_consecutive_auto_reply=5,
)

def handle_sulcus_call(call_name, call_args):
    result = mcp("tools/call", {"name": call_name, "arguments": call_args})
    return json.dumps(result.get("result", {}))

# Register all SULCUS tools as callable functions
for tool_def in tools_resp["result"]["tools"]:
    name = tool_def["name"]
    autogen.register_function(
        lambda **k, _n=name: handle_sulcus_call(_n, k),
        caller=assistant,
        executor=user_proxy,
        name=name,
        description=tool_def["description"],
    )

user_proxy.initiate_chat(assistant, message="What do you remember about our API design decisions?")
```

See `integrations/crewai/`.

---

## 8. Vercel AI SDK (TypeScript)

```typescript
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { spawn } from "child_process";
import * as readline from "readline";
import { z } from "zod";

// Start SULCUS sidecar
const proc = spawn("./target/debug/sulcus-local", ["serve"], {
  stdio: ["pipe", "pipe", "inherit"],
});
const rl = readline.createInterface({ input: proc.stdout! });

let resolveNext: ((v: string) => void) | null = null;
const queue: string[] = [];
rl.on("line", (line) => {
  if (resolveNext) {
    resolveNext(line);
    resolveNext = null;
  } else queue.push(line);
});

async function mcp(method: string, params?: Record<string, unknown>) {
  const req = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params: params ?? {},
  });
  proc.stdin!.write(req + "\n");
  return new Promise<Record<string, unknown>>((resolve) => {
    if (queue.length > 0) resolve(JSON.parse(queue.shift()!));
    else resolveNext = (line) => resolve(JSON.parse(line));
  });
}

await mcp("initialize");
const {
  result: { tools: mcpTools },
} = (await mcp("tools/list")) as any;

// Convert MCP tools → Vercel AI SDK tools
const tools: Record<string, ReturnType<typeof tool>> = {};
for (const t of mcpTools) {
  tools[t.name] = tool({
    description: t.description,
    parameters: z.object(
      Object.fromEntries(
        Object.entries(t.inputSchema?.properties ?? {}).map(
          ([k]: [string, unknown]) => [k, z.string().optional()],
        ),
      ),
    ),
    execute: async (args) => {
      const result = await mcp("tools/call", { name: t.name, arguments: args });
      return result;
    },
  });
}

const { text } = await generateText({
  model: openai("gpt-4o"),
  tools,
  maxSteps: 5,
  prompt:
    "Search SULCUS memory for anything about the authentication module, then add a note that we use JWT with a 24h expiry.",
});

console.log(text);
proc.kill();
```

See `integrations/vercel-ai/examples/chat-app.ts`.

---

## 9. Ollama / local models

SULCUS works with any Ollama model that supports tool calling (Llama 3.1+, Mistral, Qwen2.5, etc.):

```python
import ollama
import json, subprocess

proc = subprocess.Popen(["./target/debug/sulcus-local", "serve"],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)

def mcp(method, params=None):
    req = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
    proc.stdin.write(req + "\n"); proc.stdin.flush()
    return json.loads(proc.stdout.readline())

mcp("initialize")
tools_resp = mcp("tools/list")

ollama_tools = [
    {"type": "function", "function": {
        "name": t["name"],
        "description": t["description"],
        "parameters": t["inputSchema"],
    }}
    for t in tools_resp["result"]["tools"]
]

messages = [{"role": "user", "content": "What facts do you remember about our system architecture?"}]

while True:
    resp = ollama.chat(model="llama3.1", messages=messages, tools=ollama_tools)
    msg = resp["message"]
    messages.append(msg)

    if msg.get("tool_calls"):
        for tc in msg["tool_calls"]:
            fn = tc["function"]
            result = mcp("tools/call", {"name": fn["name"], "arguments": fn["arguments"]})
            messages.append({"role": "tool", "content": json.dumps(result.get("result", {}))})
    else:
        print(msg["content"])
        break
```

---

## 10. MCP over HTTP/SSE (server mode)

For web agents, remote deployments, or multi-tenant teams:

```bash
# Start the SSE server (exposes /sse and /message endpoints)
cargo run -p sulcus-local -- serve-http --bind 127.0.0.1:8080
```

```typescript
// Connect via SSE (works in any browser or Node.js environment)
const sse = new EventSource("http://localhost:8080/sse");
let sessionId: string;

sse.addEventListener("endpoint", (e) => {
  sessionId = new URL(e.data, "http://localhost:8080").searchParams.get(
    "sessionId",
  )!;
});

async function mcp(method: string, params?: unknown) {
  const resp = await fetch(
    `http://localhost:8080/message?sessionId=${sessionId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
  );
  return new Promise((resolve) => {
    sse.addEventListener("message", (e) => resolve(JSON.parse(e.data)), {
      once: true,
    });
  });
}
```

---

## 11. Raw MCP (any language)

SULCUS speaks line-delimited JSON-RPC 2.0 on stdin/stdout. Works with any language:

```bash
# Shell / curl equivalent
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | ./sulcus-local serve
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | ./sulcus-local serve
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"add_memory","arguments":{"content":"hello world"}}}' | ./sulcus-local serve
```

```go
// Go example
enc := json.NewEncoder(proc.Stdin)
dec := json.NewDecoder(proc.Stdout)
enc.Encode(map[string]any{"jsonrpc":"2.0","id":1,"method":"initialize"})
var result map[string]any
dec.Decode(&result)
```

```ruby
# Ruby example
proc = IO.popen(["./sulcus-local", "serve"], "r+")
proc.puts JSON.generate({jsonrpc: "2.0", id: 1, method: "initialize"})
proc.flush
result = JSON.parse(proc.gets)
```

---

## Tool reference

| Tool                                  | Purpose                                 | Key params                                       |
| ------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| `add_memory`                          | Store a memory node                     | `content`                                        |
| `search_memory`                       | Hybrid semantic + FTS search            | `query`, `limit`, `memory_type`                  |
| `build_context`                       | Ignite nodes + return XML context block | `prompt`, `token_budget`                         |
| `query_memory`                        | Vector-only search                      | `query`, `limit`, `fold_name`                    |
| `get_node`                            | Fetch node by ID                        | `node_id`                                        |
| `upsert_node`                         | Create/update node                      | `id`, `label`, `pointer_summary`, `current_heat` |
| `list_hot_nodes`                      | Top-N nodes by heat score               | `limit`                                          |
| `fetch_payload`                       | Retrieve raw content + ignite heat      | `node_id`                                        |
| `commit_memory`                       | Atomic node + edges insert              | `label`, `raw_content`, `connected_node_ids`     |
| `ignite_and_tick`                     | Embed prompt → ignite → decay           | `prompt`                                         |
| `forget_memory`                       | Hard delete node + edges                | `node_id`, `purge_cold`                          |
| `retract_memory`                      | Soft retract (keeps tombstone)          | `node_id`                                        |
| `update_memory`                       | Patch node content                      | `node_id`, `label`, `raw_content`                |
| `pin_node` / `unpin_node`             | Prevent/allow heat decay                | `node_id`                                        |
| `summarize`                           | Deterministic extractive summary        | `text`, `max_chars`                              |
| `active_index`                        | Fetch hot nodes from shared buffer      | `limit`                                          |
| `tick`                                | Force thermodynamics decay + rebuild    | —                                                |
| `sync_now`                            | Push/pull WAL to SULCUS server          | —                                                |
| `dispatch_background_task`            | Fire-and-forget maintenance task        | `task`                                           |
| `metrics`                             | Runtime stats                           | —                                                |
| `export_markdown` / `import_markdown` | Portable Markdown export/import         | `file_path`, `fold_name`                         |
| `record_fold` / `switch_fold`         | Namespace memories into Folds           | `fold_name`                                      |

Full JSON schemas at `integrations/openai-tools/tools.json`.

---

## Memory types

| Type         | Description                       | Best for         |
| ------------ | --------------------------------- | ---------------- |
| `episodic`   | Conversation events, task history | What happened    |
| `semantic`   | Facts, knowledge, entities        | What is true     |
| `preference` | User/system preferences           | How to behave    |
| `procedural` | Step-by-step instructions         | How to do things |

---

## Best practices

1. **Call `build_context` before every LLM turn** — it ignites relevant nodes and returns a ready-to-use XML context block you can paste directly into the system prompt.
2. **Store memories with correct `memory_type`** — use `semantic` for facts, `procedural` for workflows.
3. **Pin critical nodes** (`pin_node`) that must never decay (e.g. user identity, project constraints).
4. **Run `dispatch_background_task` with `"full_maintenance"`** at session end to keep the graph clean.
5. **Use `forget_memory` sparingly** — prefer `retract_memory` to preserve audit trails.
6. **Scope with Folds** when building multi-project agents — each project/client gets its own Fold.
