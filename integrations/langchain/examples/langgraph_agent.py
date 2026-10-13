import operator
from typing import Annotated, Sequence, TypedDict

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.base import empty_checkpoint

from sulcus import Sulcus
from sulcus_langchain import SulcusMemoryNode, SulcusSaver, get_sulcus_tools

# 1. Define the State
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]

# 2. Setup Sulcus & LLM
# Initialize the Sulcus HTTP client (pointing to local dev server or cloud)
client = Sulcus(api_key="sk-test-key", base_url="http://localhost:8080", namespace="langgraph_example")

# The specialized nodes
sulcus_memory = SulcusMemoryNode(client, namespace="langgraph_example")
sulcus_tools = get_sulcus_tools(client, namespace="langgraph_example")

llm = ChatOpenAI(model="gpt-4-turbo", temperature=0)
llm_with_tools = llm.bind_tools(sulcus_tools)

# 3. Define Graph Nodes
def call_model(state: AgentState):
    """The core agent logic."""
    response = llm_with_tools.invoke(state["messages"])
    return {"messages": [response]}

# 4. Build the Graph
workflow = StateGraph(AgentState)

# Nodes
workflow.add_node("inject_memory", sulcus_memory.inject)
workflow.add_node("agent", call_model)
workflow.add_node("tools", ToolNode(sulcus_tools))
workflow.add_node("save_memory", sulcus_memory.save)

# Edges
workflow.set_entry_point("inject_memory")
workflow.add_edge("inject_memory", "agent")

# Agent -> Tools or End
def should_continue(state: AgentState) -> str:
    messages = state["messages"]
    last_message = messages[-1]
    # If the LLM makes a tool call, route to tools
    if last_message.tool_calls:
        return "continue"
    # Otherwise route to save_memory
    return "end"

workflow.add_conditional_edges(
    "agent",
    should_continue,
    {
        "continue": "tools",
        "end": "save_memory",
    },
)

workflow.add_edge("tools", "agent")
workflow.add_edge("save_memory", END)

# 5. Compile with Checkpointer
checkpointer = SulcusSaver(client, namespace_prefix="lg_chk:")
app = workflow.compile(checkpointer=checkpointer)

# 6. Run the Agent
if __name__ == "__main__":
    thread_id = "test_thread_01"
    config = {"configurable": {"thread_id": thread_id}}
    
    print(f"--- Starting Thread: {thread_id} ---")
    
    # Interaction 1
    query = "Hi! I'm learning LangGraph and my favorite color is blue."
    print(f"User: {query}")
    events = app.stream(
        {"messages": [HumanMessage(content=query)]},
        config,
        stream_mode="values"
    )
    for event in events:
        if "messages" in event:
            last = event["messages"][-1]
            if isinstance(last, AIMessage) and last.content:
                print(f"Agent: {last.content}")
                
    # Checkpointer lets us resume perfectly
    print("\n--- Resuming Thread ---")
    query_2 = "What did I say my favorite color was?"
    print(f"User: {query_2}")
    
    events = app.stream(
        {"messages": [HumanMessage(content=query_2)]},
        config,
        stream_mode="values"
    )
    for event in events:
        if "messages" in event:
            last = event["messages"][-1]
            if isinstance(last, AIMessage) and last.content:
                print(f"Agent: {last.content}")
