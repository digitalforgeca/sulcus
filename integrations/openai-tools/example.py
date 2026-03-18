"""
Sulcus + OpenAI — complete working example.

Shows how to wire Sulcus memory tools into an OpenAI chat completion loop,
including multi-turn conversation with automatic tool call handling.

Requirements:
    pip install openai

Environment:
    OPENAI_API_KEY   — your OpenAI API key
    SULCUS_API_KEY   — your Sulcus API key
    SULCUS_BASE_URL  — Sulcus server base URL (default: https://server.sulcus.ca)
"""

import json
import os

from openai import OpenAI

from handler import handle_tool_call

# Load tool definitions from tools.json (same directory as this script)
_HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_HERE, "tools.json")) as f:
    SULCUS_TOOLS = json.load(f)


def chat_with_memory(
    user_message: str,
    conversation_history: list | None = None,
    model: str = "gpt-4o",
    system_prompt: str | None = None,
) -> tuple[str, list]:
    """Send a message to GPT-4o with Sulcus memory tools available.

    Args:
        user_message: The user's input.
        conversation_history: Existing messages list (mutated in-place).
        model: OpenAI model to use.
        system_prompt: Optional custom system prompt.

    Returns:
        (assistant_reply, updated_conversation_history)
    """
    client = OpenAI()  # reads OPENAI_API_KEY from env

    if conversation_history is None:
        conversation_history = []

    if not conversation_history:
        sys_prompt = system_prompt or (
            "You are a helpful AI assistant with access to a persistent memory system (Sulcus). "
            "When the user shares important information, preferences, or facts, store them with "
            "sulcus_remember. Before answering questions about past context, search memory with "
            "sulcus_search. Use sulcus_list to browse what's stored. Use sulcus_update to correct "
            "memories and sulcus_forget to delete them when explicitly asked."
        )
        conversation_history.append({"role": "system", "content": sys_prompt})

    conversation_history.append({"role": "user", "content": user_message})

    # Agentic loop: keep calling the model until it stops asking for tools
    while True:
        response = client.chat.completions.create(
            model=model,
            messages=conversation_history,
            tools=SULCUS_TOOLS,
            tool_choice="auto",
        )

        message = response.choices[0].message
        conversation_history.append(message)  # add assistant turn

        # No tool calls → we have the final answer
        if not message.tool_calls:
            return message.content or "", conversation_history

        # Execute each requested tool call
        for tool_call in message.tool_calls:
            print(f"  [tool] {tool_call.function.name}({tool_call.function.arguments})")
            result_content = handle_tool_call(tool_call)
            print(f"  [result] {result_content[:120]}{'...' if len(result_content) > 120 else ''}")

            conversation_history.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result_content,
            })
        # Loop back — model will use tool results to form its reply


def main():
    """Interactive REPL demonstrating Sulcus memory with GPT."""
    print("Sulcus + OpenAI Memory Demo")
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
        print(f"Assistant: {reply}\n")

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
                role = getattr(msg, "role", msg.get("role", "?")) if hasattr(msg, "role") else msg.get("role", "?")
                content = getattr(msg, "content", msg.get("content", "")) if hasattr(msg, "content") else msg.get("content", "")
                if content:
                    print(f"  {role}: {str(content)[:80]}")
            print()
            continue

        reply, history = chat_with_memory(user_input, history)
        print(f"Assistant: {reply}\n")


if __name__ == "__main__":
    main()
