"""Sulcus LangGraph Native Integration."""

from typing import Any, Callable, Dict, List, Optional
from langchain_core.messages import BaseMessage, SystemMessage, HumanMessage, AIMessage
from langchain_core.tools import tool
from sulcus import Sulcus

def format_context_prompt(memories: List[Any], entities: Dict[str, Any]) -> str:
    """Format Sulcus memories into a system prompt block."""
    lines = ["<sulcus_context>"]
    
    if memories:
        lines.append("<relevant_memories>")
        for m in memories:
            lines.append(f"- {m.pointer_summary} (heat: {m.current_heat:.2f})")
        lines.append("</relevant_memories>")
        
    if entities and "entities" in entities and entities["entities"]:
        lines.append("<graph_context>")
        for e in entities["entities"]:
            lines.append(f"Entity: {e['name']}")
            for n in e.get("neighbors", []):
                lines.append(f"  - [{n['relation']}] -> {n['target_name']}")
        lines.append("</graph_context>")
        
    lines.append("</sulcus_context>")
    return "\n".join(lines)


class SulcusMemoryNode:
    """A LangGraph node that manages proactive context injection and episodic storage.
    
    Usage in LangGraph:
        memory_node = SulcusMemoryNode(client)
        
        # Add to graph
        graph.add_node("inject_context", memory_node.inject)
        graph.add_node("save_memory", memory_node.save)
        
        # Edges
        graph.add_edge("inject_context", "agent")
        graph.add_edge("agent", "save_memory")
    """
    
    def __init__(self, client: Sulcus, namespace: str = "default", max_context_tokens: int = 2000):
        self.client = client
        self.namespace = namespace
        self.max_context_tokens = max_context_tokens

    def inject(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Inject Sulcus proactive context into the conversation state.
        
        Takes the latest human message, searches Sulcus, and returns a new SystemMessage
        containing the injected context.
        """
        messages: List[BaseMessage] = state.get("messages", [])
        if not messages:
            return {}
            
        # Find the latest human message
        latest_human = next((m for m in reversed(messages) if isinstance(m, HumanMessage)), None)
        if not latest_human or not isinstance(latest_human.content, str):
            # No text query to search on
            return {}
            
        query = latest_human.content
        context_str = self.client.build_context(
            query=query,
            token_budget=self.max_context_tokens,
            namespace=self.namespace,
        )
        
        return {
            "messages": [SystemMessage(content=context_str)]
        }

    def save(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Save the latest exchange to Sulcus."""
        messages: List[BaseMessage] = state.get("messages", [])
        if len(messages) < 2:
            return {}
            
        # Find latest exchange (Human -> AI)
        ai_msg = messages[-1]
        if not isinstance(ai_msg, AIMessage):
            return {}
            
        human_msg = next((m for m in reversed(messages[:-1]) if isinstance(m, HumanMessage)), None)
        
        if human_msg:
            # Store the exchange as an episodic memory
            exchange = f"User: {human_msg.content}\nAI: {ai_msg.content}"
            self.client.remember(
                content=exchange,
                memory_type="episodic",
                heat=0.8,
                namespace=self.namespace,
                train_on_this=True # Triggers SIU to automatically extract semantic facts
            )
            
        return {}


def get_sulcus_tools(client: Sulcus, namespace: str = "default") -> List[Callable]:
    """Exposes Sulcus memory feedback loops as LangChain tools."""
    
    @tool
    def boost_memory(memory_id: str, amount: float = 0.2) -> str:
        """Boost the heat (accessibility) of a specific memory by its ID. Use this when a memory was highly relevant."""
        try:
            client.boost_batch([{"id": memory_id, "heat": amount}])
            return f"Successfully boosted memory {memory_id} by {amount}."
        except Exception as e:
            return f"Failed to boost memory: {e}"
            
    @tool
    def forget_memory(memory_id: str) -> str:
        """Permanently forget a specific memory by its ID. Use this when a memory is incorrect, outdated, or hallucinated."""
        try:
            client.forget(memory_id, train_on_this=True)
            return f"Successfully forgot memory {memory_id}."
        except Exception as e:
            return f"Failed to forget memory: {e}"
            
    @tool
    def add_fact(fact: str) -> str:
        """Explicitly store a semantic fact in the agent's long-term memory."""
        try:
            client.remember(
                content=fact,
                memory_type="semantic",
                heat=1.0,
                namespace=namespace
            )
            return "Successfully stored fact."
        except Exception as e:
            return f"Failed to store fact: {e}"

    return [boost_memory, forget_memory, add_fact]
