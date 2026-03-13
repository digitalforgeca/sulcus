"""Example: Sulcus-backed RAG pipeline with LlamaIndex.

This script demonstrates a complete workflow:
  1. Load existing Sulcus memories as LlamaIndex Documents
  2. Store new documents into the Sulcus vector store
  3. Build a VectorStoreIndex
  4. Run natural-language queries against it

Requirements:
    pip install sulcus-llamaindex llama-index-core

Usage:
    SULCUS_API_KEY=sk-... python rag_pipeline.py
"""

from __future__ import annotations

import os

from llama_index.core import (
    StorageContext,
    VectorStoreIndex,
)
from llama_index.core.schema import Document

from sulcus_llamaindex import SulcusReader, SulcusVectorStore

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

API_KEY = os.environ.get("SULCUS_API_KEY", "sk-your-key-here")
NAMESPACE = "rag-demo"

# ---------------------------------------------------------------------------
# Step 1: Load existing memories from Sulcus as LlamaIndex Documents
# ---------------------------------------------------------------------------

print("Loading memories from Sulcus...")
reader = SulcusReader(api_key=API_KEY, namespace=NAMESPACE)

# Load all semantic memories in this namespace.
existing_docs = reader.load_by_type("semantic", namespace=NAMESPACE)
print(f"  Loaded {len(existing_docs)} existing semantic memories.")

# Also load all pinned memories (these have preserved heat — high importance).
pinned_docs = reader.load_pinned(namespace=NAMESPACE)
print(f"  Loaded {len(pinned_docs)} pinned memories.")

# ---------------------------------------------------------------------------
# Step 2: Set up the Sulcus-backed vector store and storage context
# ---------------------------------------------------------------------------

print("\nSetting up SulcusVectorStore...")
vector_store = SulcusVectorStore(
    api_key=API_KEY,
    namespace=NAMESPACE,
)
storage_context = StorageContext.from_defaults(vector_store=vector_store)

# ---------------------------------------------------------------------------
# Step 3: Index new documents (they'll be stored in Sulcus automatically)
# ---------------------------------------------------------------------------

new_documents = [
    Document(
        text="Sulcus uses thermodynamic principles — heat represents memory accessibility.",
        metadata={
            "memory_type": "semantic",
            "heat": 0.9,
            "namespace": NAMESPACE,
        },
    ),
    Document(
        text="Pinned memories resist heat decay and remain accessible indefinitely.",
        metadata={
            "memory_type": "semantic",
            "heat": 0.85,
            "namespace": NAMESPACE,
        },
    ),
    Document(
        text="Episodic memories record specific events with timestamps and context.",
        metadata={
            "memory_type": "episodic",
            "heat": 0.7,
            "namespace": NAMESPACE,
        },
    ),
    Document(
        text="Procedural memories encode how-to knowledge and step-by-step instructions.",
        metadata={
            "memory_type": "procedural",
            "heat": 0.75,
            "namespace": NAMESPACE,
        },
    ),
]

print(f"\nIndexing {len(new_documents)} new documents into Sulcus...")

# Combine existing + new documents into the index.
all_docs = existing_docs + pinned_docs + new_documents

index = VectorStoreIndex.from_documents(
    all_docs,
    storage_context=storage_context,
    show_progress=True,
)
print("  Index built.")

# ---------------------------------------------------------------------------
# Step 4: Query the index
# ---------------------------------------------------------------------------

print("\nRunning queries against the Sulcus-backed index...\n")
query_engine = index.as_query_engine(similarity_top_k=3)

queries = [
    "How does Sulcus manage memory accessibility?",
    "What are pinned memories?",
    "How are procedural memories different from episodic ones?",
]

for q in queries:
    print(f"Q: {q}")
    response = query_engine.query(q)
    print(f"A: {response}\n")

# ---------------------------------------------------------------------------
# Step 5: Direct search (bypassing the query engine)
# ---------------------------------------------------------------------------

print("Direct search (SulcusReader.search):")
results = reader.search("thermodynamic heat decay", limit=5)
for doc in results:
    heat = doc.metadata.get("heat", 0)
    mtype = doc.metadata.get("memory_type", "?")
    print(f"  [{mtype} | heat={heat:.2f}] {doc.text[:80]}")
