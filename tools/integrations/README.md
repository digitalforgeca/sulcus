# SULCUS Integration Examples

Ready-to-run examples for every major LLM platform.

## Prerequisites

```bash
# Build SULCUS binary
cargo build -p sulcus
```

## Examples

| File                    | Framework     | Language   | Cloud    | Model                      |
| ----------------------- | ------------- | ---------- | -------- | -------------------------- |
| `anthropic_example.py`  | Anthropic SDK | Python     | ✅       | Claude                     |
| `openai_example.py`     | OpenAI SDK    | Python     | ✅       | GPT-4o                     |
| `langchain_example.py`  | LangChain     | Python     | ✅       | Any OpenAI-compatible      |
| `llamaindex_example.py` | LlamaIndex    | Python     | ✅       | Any OpenAI-compatible      |
| `autogen_example.py`    | AutoGen / AG2 | Python     | ✅       | GPT-4o                     |
| `ollama_example.py`     | Ollama        | Python     | 🔒 Local | Llama 3.1 / Qwen / Mistral |
| `gemini_example.py`     | Google GenAI  | Python     | ✅       | Gemini 2.0 Flash           |
| `vercel_ai_example.ts`  | Vercel AI SDK | TypeScript | ✅       | GPT-4o                     |

## Quick start

```bash
# Python examples
pip install anthropic openai langchain langchain-openai \
            llama-index llama-index-llms-openai pyautogen ollama google-genai

export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...

python tools/integrations/openai_example.py
python tools/integrations/anthropic_example.py
python tools/integrations/langchain_example.py
python tools/integrations/ollama_example.py   # no API key needed
python tools/integrations/gemini_example.py

# TypeScript (Vercel AI SDK)
cd tools/integrations
npm install ai @ai-sdk/openai zod tsx
npx tsx vercel_ai_example.ts
```

## Universal tool manifest

`tools/manifests/openai_tools.json` — all SULCUS tools in OpenAI function-calling JSON Schema format, consumable by any LLM SDK.

## MCP config templates

`tools/manifests/claude_mcp.json` — drop-in configs for:

- Claude Desktop
- Cursor IDE
- Continue.dev
- Cline (VS Code)
- Windsurf

See [INTEGRATIONS.md](../../INTEGRATIONS.md) for full documentation.
