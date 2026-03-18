# sulcus-llamaindex

LlamaIndex storage integration for [Sulcus](https://sulcus.ca) — a thermodynamic memory system for AI agents.

## What is Sulcus?

Sulcus stores AI memories as nodes with a **heat** value (0–1) that represents accessibility. Memories naturally cool over time; pinned memories retain their heat indefinitely. This creates a biologically-inspired attention gradient across your agent's knowledge graph.

## Installation

```bash
pip install sulcus-llamaindex
```

> **Note:** Only `llama-index-core` is required — not the full `llama-index` package.

## Components

| Class | Purpose |
|---|---|
| `SulcusVectorStore` | Drop-in `BasePydanticVectorStore` for RAG pipelines |
| `SulcusDocumentStore` | KV-style document persistence |
| `SulcusReader` | Load existing Sulcus memories as LlamaIndex `Document` objects |

---

## Usage

### SulcusVectorStore — RAG Pipeline

```python
from llama_index.core import VectorStoreIndex, StorageContext
from llama_index.core.schema import Document
from sulcus_llamaindex import SulcusVectorStore

# Set up the store
vector_store = SulcusVectorStore(
    api_key="sk-...",
    namespace="my-project",       # logical namespace in Sulcus
)
storage_context = StorageContext.from_defaults(vector_store=vector_store)

# Index documents — they're persisted to Sulcus automatically
docs = [
    Document(
        text="Pinned memories resist heat decay.",
        metadata={
            "memory_type": "semantic",   # episodic | semantic | preference | procedural
            "heat": 0.9,                 # 0.0–1.0, higher = more accessible
            "namespace": "my-project",
        },
    ),
]
index = VectorStoreIndex.from_documents(docs, storage_context=storage_context)

# Query
response = index.as_query_engine(similarity_top_k=5).query("What are pinned memories?")
print(response)
```

### Metadata Mapping

LlamaIndex node metadata fields are mapped to Sulcus fields on `add()`:

| LlamaIndex metadata key | Sulcus field | Default |
|---|---|---|
| `memory_type` | `memory_type` | `"semantic"` |
| `heat` | `heat` | `0.8` |
| `namespace` | `namespace` | store default |

Returned nodes (from `query()`) include all Sulcus fields in metadata:
`sulcus_id`, `memory_type`, `heat`, `base_utility`, `is_pinned`, `modality`, `namespace`.

---

### SulcusReader — Load Existing Memories

```python
from sulcus_llamaindex import SulcusReader

reader = SulcusReader(api_key="sk-...", namespace="research")

# Load all memories of a specific type
docs = reader.load_by_type("semantic")

# Load only pinned (high-importance) memories
pinned = reader.load_pinned()

# Filter by namespace, type, and pinned status simultaneously
docs = reader.load_data(
    memory_type="episodic",
    namespace="project-x",
    pinned=False,
    search="deployment",   # optional server-side substring filter
)

# Quick search returning Documents
results = reader.search("thermodynamic heat", limit=10)
```

---

### SulcusDocumentStore — Document Persistence

```python
from llama_index.core import StorageContext
from sulcus_llamaindex import SulcusDocumentStore

doc_store = SulcusDocumentStore(api_key="sk-...", namespace="my-project")
storage_context = StorageContext.from_defaults(docstore=doc_store)
```

Document nodes are stored under a `docstore:<namespace>` Sulcus namespace as `procedural` memories, keeping them separate from your semantic memory graph.

---

## Full Example

See [`examples/rag_pipeline.py`](examples/rag_pipeline.py) for a complete workflow:
1. Load existing Sulcus memories as LlamaIndex Documents
2. Store new documents into the vector store
3. Build a `VectorStoreIndex`
4. Run natural-language queries

```bash
SULCUS_API_KEY=sk-... python examples/rag_pipeline.py
```

---

## Thermodynamic Tips

- **Use `heat=0.9`** for core knowledge you want to remain accessible long-term.
- **Pin critical memories** via the Sulcus API (`client.pin(memory_id)`) to prevent any heat decay.
- **Use namespaces** to partition memory by project, agent, or session — they're free and unlimited.
- **`memory_type` matters:** Sulcus's UI and search can filter by type, so labelling memories correctly improves discoverability.

---

## Requirements

- Python ≥ 3.9
- `sulcus >= 0.1.0`
- `llama-index-core >= 0.12.0`

## License

MIT
