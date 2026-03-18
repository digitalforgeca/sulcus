"""Basic chain example: ChatOpenAI + SulcusMemory.

Demonstrates a simple conversational loop where each turn is persisted to
Sulcus and relevant context is retrieved before each response.

Requirements:
    pip install sulcus-langchain langchain-openai

Usage:
    SULCUS_API_KEY=sk-... OPENAI_API_KEY=sk-... python examples/basic_chain.py
"""

from __future__ import annotations

import os

from langchain_core.prompts import PromptTemplate

try:
    from langchain_openai import ChatOpenAI
except ImportError:
    raise ImportError(
        "This example requires langchain-openai.\n"
        "Install with: pip install langchain-openai"
    )

from sulcus import Sulcus
from sulcus_langchain import SulcusMemory, SulcusChatMessageHistory, SulcusRetriever


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SULCUS_API_KEY: str = os.environ.get("SULCUS_API_KEY", "")
SULCUS_SERVER: str = os.environ.get("SULCUS_SERVER", "https://api.sulcus.ca")
OPENAI_API_KEY: str = os.environ.get("OPENAI_API_KEY", "")
NAMESPACE: str = os.environ.get("SULCUS_NAMESPACE", "example-chat")
SESSION_ID: str = os.environ.get("SULCUS_SESSION_ID", "demo-session-001")

if not SULCUS_API_KEY:
    raise EnvironmentError("Set the SULCUS_API_KEY environment variable.")
if not OPENAI_API_KEY:
    raise EnvironmentError("Set the OPENAI_API_KEY environment variable.")


# ---------------------------------------------------------------------------
# Initialise Sulcus client and LangChain components
# ---------------------------------------------------------------------------

sulcus = Sulcus(
    api_key=SULCUS_API_KEY,
    base_url=SULCUS_SERVER,
    namespace=NAMESPACE,
)

# Conversational memory — fetches and stores full turn context
memory = SulcusMemory(
    client=sulcus,
    memory_type="conversation",   # maps to "episodic" inside Sulcus
    memory_key="history",
    search_limit=8,
    heat=0.85,
    return_messages=False,        # inject as formatted string, not message list
)

# Per-session structured chat log (optional — shows raw message history)
chat_history = SulcusChatMessageHistory(
    client=sulcus,
    session_id=SESSION_ID,
    heat=0.75,
)

# Document retriever for standalone RAG queries
retriever = SulcusRetriever(
    client=sulcus,
    search_limit=5,
    min_heat=0.2,
)


# ---------------------------------------------------------------------------
# Prompt + LLM
# ---------------------------------------------------------------------------

llm = ChatOpenAI(
    model="gpt-4o-mini",
    temperature=0.7,
    openai_api_key=OPENAI_API_KEY,
)

PROMPT_TEMPLATE = (
    "You are a helpful assistant with persistent memory powered by Sulcus.\n\n"
    "Relevant memory context:\n"
    "{history}\n\n"
    "Human: {input}\n"
    "AI:"
)

prompt = PromptTemplate(
    input_variables=["history", "input"],
    template=PROMPT_TEMPLATE,
)


def chat(user_input: str) -> str:
    """Run one conversational turn with Sulcus-backed memory.

    1. Loads relevant memories from Sulcus matching the user input.
    2. Formats the prompt with history + input.
    3. Calls the LLM for a response.
    4. Saves both the human input and AI response back to Sulcus.
    5. Appends the turn to the structured chat history.

    Args:
        user_input: The user's message text.

    Returns:
        The AI assistant's response string.
    """
    # 1. Retrieve relevant memories
    mem_vars = memory.load_memory_variables({"input": user_input})

    # 2. Build and invoke the chain
    formatted = prompt.format(input=user_input, **mem_vars)
    response = llm.invoke(formatted)
    ai_text: str = response.content if hasattr(response, "content") else str(response)

    # 3. Persist this turn to Sulcus
    memory.save_context({"input": user_input}, {"output": ai_text})

    # 4. Also store in the structured session history
    chat_history.add_user_message(user_input)
    chat_history.add_ai_message(ai_text)

    return ai_text


def demo_retriever(query: str) -> None:
    """Show how SulcusRetriever works as a standalone RAG component."""
    print(f"\n[Retriever] Searching: {query!r}")
    docs = retriever.invoke(query)
    if not docs:
        print("  No documents found.")
        return
    for doc in docs:
        heat = doc.metadata.get("heat", 0.0)
        mtype = doc.metadata.get("memory_type", "?")
        print(f"  [{mtype}] heat={heat:.2f}  {doc.page_content[:100]}")


# ---------------------------------------------------------------------------
# Main interactive loop
# ---------------------------------------------------------------------------

def main() -> None:
    """Run an interactive chat session with Sulcus-backed memory."""
    print("Sulcus + LangChain demo — type 'quit' to exit, '!search <query>' to use retriever.\n")

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye.")
            break

        if not user_input:
            continue

        if user_input.lower() in ("quit", "exit"):
            print("Goodbye.")
            break

        if user_input.startswith("!search "):
            query = user_input[len("!search "):]
            demo_retriever(query)
            continue

        response = chat(user_input)
        print(f"AI: {response}\n")


if __name__ == "__main__":
    main()
