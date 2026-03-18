"""
Sulcus + Anthropic Claude — complete working example.

Shows how to wire Sulcus memory tools into an Anthropic messages loop,
including multi-turn conversation with automatic tool_use handling.

Requirements:
    pip install anthropic

Environment:
    ANTHROPIC_API_KEY  — your Anthropic API key
    SULCUS_API_KEY     — your Sulcus API key
    SULCUS_BASE_URL    — Sulcus server base URL (default: https://server.sulcus.ca)
"""

import json
import os

import anthropic

from handler import handle_tool_use

# Load tool definitions from tools.json (same directory as this script)
_HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_HERE, "tools.json")) as f:
    SULCUS_TOOLS = json.load(f)

SYSTEM_PROMPT = (
    "You are a helpful AI assistant with access to a persistent memory system (Sulcus). "
    "When the user shares important information, preferences, or facts, store them with "
    "sulcus_remember. Before answering questions about past context, search memory with "
    "sulcus_search. Use sulcus_list to browse what's stored. Use sulcus_update to correct "
    "memories and sulcus_forget to delete them when explicitly asked."
)


def chat_with_memory(
    user_message: str,
    conversation_history: list | None = None,
    model: str = "claude-opus-4-5",
    max_tokens: int = 4096,
) -> tuple[str, list]:
    """Send a message to Claude with Sulcus memory tools available.

    Args:
        user_message: The user's input.
        conversation_history: Existing messages list (mutated in-place).
        model: Anthropic model to use.
        max_tokens: Maximum tokens in the response.

    Returns:
        (assistant_reply, updated_conversation_history)
    """
    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from env

    if conversation_history is None:
        conversation_history = []

    conversation_history.append({"role": "user", "content": user_message})

    # Agentic loop: keep calling the model until stop_reason != "tool_use"
    while True:
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=SYSTEM_PROMPT,
            tools=SULCUS_TOOLS,
            messages=conversation_history,
        )

        # Add assistant turn to history
        conversation_history.append({
            "role": "assistant",
            "content": response.content,
        })

        # No tool calls → extract text and return
        if response.stop_reason != "tool_use":
            text_parts = [
                block.text for block in response.content
                if hasattr(block, "text")
            ]
            return "\n".join(text_parts), conversation_history

        # Process all tool_use blocks in this response
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                print(f"  [tool] {block.name}({json.dumps(block.input)[:80]})")
                result = handle_tool_use(block)
                print(f"  [result] {result['content'][:120]}{'...' if len(result['content']) > 120 else ''}")
                tool_results.append(result)

        # Feed tool results back as a user message
        conversation_history.append({
            "role": "user",
            "content": tool_results,
        })
        # Loop back — Claude will use results to form its reply


def main():
    """Interactive REPL demonstrating Sulcus memory with Claude."""
    print("Sulcus + Anthropic Claude Memory Demo")
    print("Type 'quit' to exit, 'history' to see conversation, 'clear' to reset.\n")

    history = []

    # Seed a few example interactions
    demo_turns = [
        "My name is Alex and I'm building a SaaS product for indie game developers.",
        "I prefer TypeScript over JavaScript for all new projects.",
        "What do you know about me so far? Check your memory.",
        "Update my name to Alexandra.",
        "What's stored in memory right now? List everything.",
    ]

    for turn in demo_turns:
        print(f"User: {turn}")
        reply, history = chat_with_memory(turn, history)
        print(f"Claude: {reply}\n")

    # Interactive loop
    while True:
        user_input = input("You: ").strip()
        if not user_input:
            continue
        if user_input.lower() == "quit":
            break
        if user_input.lower() == "clear":
            history = []
            print("[Conversation cleared]\n")
            continue
        if user_input.lower() == "history":
            for msg in history:
                role = msg.get("role", "?")
                content = msg.get("content", "")
                if isinstance(content, str) and content:
                    print(f"  {role}: {content[:80]}")
                elif isinstance(content, list):
                    for block in content:
                        if hasattr(block, "text") and block.text:
                            print(f"  {role}: {block.text[:80]}")
                        elif isinstance(block, dict) and block.get("type") == "text":
                            print(f"  {role}: {block['text'][:80]}")
            print()
            continue

        reply, history = chat_with_memory(user_input, history)
        print(f"Claude: {reply}\n")


if __name__ == "__main__":
    main()
