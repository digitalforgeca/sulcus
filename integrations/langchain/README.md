# sulcus-langchain

LangChain memory backend for [Sulcus](https://sulcus.ca) — thermodynamic memory for AI agents.

Sulcus stores memories as nodes with **heat** (thermodynamic relevance) that decays over time.
This integration exposes Sulcus as three LangChain primitives:

| Class | LangChain base | Purpose |
|---|---|---|
| `SulcusMemory` | `BaseMemory` | Plug-in memory for chains (load + save) |
| `SulcusChatMessageHistory` | `BaseChatMessageHistory` | Per-session chat history |
| `SulcusRetriever` | `BaseRetriever` | Semantic search over stored memories |

---

## Installation

```bash
pip install sulcus-langchain

# For async support (AsyncSulcus):
pip install sulcus-langchain[async]
```

> **Note:** This package imports only from `langchain-core` — not the full `langchain` package.

---

## Quick Start

### SulcusMemory — drop-in chain memory

```python
from sulcus import Sulcus
from sulcus_langchain import SulcusMemory
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_openai import ChatOpenAI

client = Sulcus(api_key="sk-...", namespace="my-chatbot")
memory = SulcusMemory(client=client, memory_type="conversation")

# Load memories relevant to the current input
variables = memory.load_memory_variables({"input": "Tell me about photosynthesis"})
print(variables["history"])  # formatted string of relevant memories

# After a chain turn, persist the exchange
memory.save_context(
    {"input": "Tell me about photosynthesis"},
    {"output": "Photosynthesis is the process by which plants convert light..."},
)
```

**Memory type mapping:**

| `memory_type` | Sulcus type |
|---|---|
| `"conversation"` | `"episodic"` |
| `"facts"` | `"semantic"` |
| `"preferences"` | `"preference"` |
| `"procedures"` | `"procedural"` |

---

### SulcusChatMessageHistory — per-session chat history

```python
from sulcus import Sulcus
from sulcus_langchain import SulcusChatMessageHistory

client = Sulcus(api_key="sk-...", namespace="chatbot")
history = SulcusChatMessageHistory(client=client, session_id="user-123")

history.add_user_message("What's the capital of France?")
history.add_ai_message("The capital of France is Paris.")

for msg in history.messages:
    print(f"{msg.type}: {msg.content}")

# Clear a session's history
history.clear()
```

---

### SulcusRetriever — RAG over stored memories

```python
from sulcus import Sulcus
from sulcus_langchain import SulcusRetriever

client = Sulcus(api_key="sk-...", namespace="knowledge-base")
retriever = SulcusRetriever(
    client=client,
    search_limit=5,
    memory_type="semantic",  # only fetch facts
    min_heat=0.3,             # ignore cold (low-relevance) memories
)

docs = retriever.invoke("What do we know about the user's preferences?")
for doc in docs:
    print(doc.page_content)
    print(doc.metadata)  # {"memory_id": ..., "heat": 0.87, "memory_type": "semantic", ...}
```

---

### Full chain example

See [`examples/basic_chain.py`](examples/basic_chain.py) for a complete ChatOpenAI + SulcusMemory chain.

```python
from sulcus import Sulcus
from sulcus_langchain import SulcusMemory
from langchain_core.prompts import PromptTemplate
from langchain_openai import ChatOpenAI

client = Sulcus(api_key="sk-sulcus-...", namespace="assistant")
memory = SulcusMemory(
    client=client,
    memory_type="conversation",
    memory_key="history",
    search_limit=8,
)

llm = ChatOpenAI(model="gpt-4o-mini")
prompt = PromptTemplate.from_template(
    "Relevant context:\n{history}\n\nHuman: {input}\nAI:"
)

# Manual chain loop
user_input = "What was my last question?"
mem_vars = memory.load_memory_variables({"input": user_input})
response = llm.invoke(prompt.format(input=user_input, **mem_vars))
memory.save_context({"input": user_input}, {"output": response.content})
```

---

## Configuration

All classes accept these common parameters:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `client` | `Sulcus` | required | Initialised Sulcus client |
| `memory_type` | `str` | `"conversation"` | Memory type label (SulcusMemory only) |
| `heat` | `float` | `0.8` | Initial heat for new memory nodes |
| `search_limit` | `int` | `10` | Max memories returned per search |
| `namespace` | `str` | client default | Sulcus namespace |

---

## Architecture

```
LangChain chain
     │
     ├── load_memory_variables(inputs)
     │        └── Sulcus.search(query, memory_type=...)
     │                 └── GET /api/v1/agent/search
     │
     └── save_context(inputs, outputs)
              └── Sulcus.remember(content, memory_type=...)
                       └── POST /api/v1/agent/nodes
```

Memory nodes are stored in the Sulcus golden index with thermodynamic heat.
Over time, unused memories cool down and become less retrievable — natural forgetting.
Pin important memories with `client.pin(memory_id)` to prevent decay.

---

## License

MIT © dforge
