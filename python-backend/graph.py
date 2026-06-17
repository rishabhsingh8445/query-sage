import os
import json
from typing import TypedDict, Annotated, Sequence
from operator import add
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage, ToolMessage, AIMessage
from langgraph.graph import StateGraph, START, END
from langchain_nvidia_ai_endpoints import ChatNVIDIA
from tools import create_tools, DbConfig

class GraphState(TypedDict):
    original_query: str
    schema_context: str
    messages: Annotated[list[BaseMessage], add]
    optimized_query: str
    iterations: int
    db_config: DbConfig
    on_trace: any

def create_optimization_graph():
    
    llm = ChatNVIDIA(
        model="meta/llama-3.3-70b-instruct",
        api_key=os.getenv("NVIDIA_API_KEY", "dummy-key-to-bypass-init"),
        temperature=0.1
    )

    def schema_analyst(state: GraphState):
        if state.get("on_trace"): state["on_trace"]("✓ Analyzing Schema (Schema Analyst)")
        
        tools_list = create_tools(state.get("db_config"), state.get("on_trace"))
        schema_tools = [t for t in tools_list if t.name in ["get_schema", "get_indexes"]]
        
        analyst_llm = llm.bind_tools(schema_tools)
        
        messages = [
            SystemMessage(content="You are the Schema Analyst. Fetch schema/indexes for tables mentioned in the query. Call tools if needed. Return a short summary of schema."),
            HumanMessage(content=f"Query: {state.get('original_query')}\n\nExisting Schema (if any): {state.get('schema_context')}")
        ]
        
        res = analyst_llm.invoke(messages)
        new_messages = [res]
        enriched_schema = state.get("schema_context", "")
        
        if getattr(res, "tool_calls", None):
            for tc in res.tool_calls:
                tool = next((t for t in schema_tools if t.name == tc["name"]), None)
                if tool:
                    tool_result = tool.invoke(tc["args"])
                    new_messages.append(ToolMessage(tool_call_id=tc["id"], content=str(tool_result), name=tc["name"]))
                    enriched_schema += f"\n\n[Tool Result from {tc['name']}]:\n{tool_result}"
        
        return {"messages": new_messages, "schema_context": enriched_schema}

    def sql_generator(state: GraphState):
        if state.get("on_trace"): state["on_trace"]("✓ Generating Optimized SQL (SQL Generator)")
        
        messages = [
            SystemMessage(content="You are the SQL Generator. Rewrite the original query to be more optimized based on the schema and previous findings. Return ONLY the rewritten SQL query in plain text, without markdown blocks."),
            HumanMessage(content=f"Original Query:\n{state.get('original_query')}\n\nSchema Context:\n{state.get('schema_context')}")
        ]
        
        res = llm.invoke(messages)
        
        optimized = res.content.strip()
        if optimized.startswith("```"):
            optimized = optimized.split("```")[1]
            if optimized.startswith("sql\n"):
                optimized = optimized[4:]
            optimized = optimized.strip()
            
        return {"optimized_query": optimized, "messages": [res]}

    def performance_optimizer(state: GraphState):
        iterations = state.get("iterations", 0) + 1
        if state.get("on_trace"): state["on_trace"](f"✓ Evaluating Cost (Performance Optimizer) - Iteration {iterations}")
        
        tools_list = create_tools(state.get("db_config"), state.get("on_trace"))
        perf_tools = [t for t in tools_list if t.name in ["run_explain", "analyze_cost", "optimize_indexes"]]
        
        perf_llm = llm.bind_tools(perf_tools)
        
        messages = [
            SystemMessage(content='''You are the Performance Optimizer. 
1. Use 'run_explain' to test the Optimized Query against the database.
2. If the query does a sequential scan or is slow, use 'optimize_indexes' to suggest an index.
3. If the query is fundamentally flawed, return the exact phrase "HIGH_COST_REWRITE" in your final message to trigger a self-correction loop.
4. When you are done, return a JSON block EXACTLY matching this structure:
{
  "optimized_query": "<the final rewritten SQL>",
  "explanation": "<detailed explanation of changes>",
  "bottlenecks": [{"type": "SEQ_SCAN", "table": "...", "description": "...", "severity": "HIGH"}],
  "suggested_indexes": [{"statement": "CREATE INDEX...", "reason": "..."}],
  "estimated_improvement": "...",
  "execution_plan_summary": "...",
  "query_complexity_score": 85
}'''),
            HumanMessage(content=f"Original Query:\n{state.get('original_query')}\n\nOptimized Query to test:\n{state.get('optimized_query')}")
        ]
        
        res = perf_llm.invoke(messages)
        new_messages = [res]
        
        if getattr(res, "tool_calls", None):
            for tc in res.tool_calls:
                tool = next((t for t in perf_tools if t.name == tc["name"]), None)
                if tool:
                    tool_result = tool.invoke(tc["args"])
                    new_messages.append(ToolMessage(tool_call_id=tc["id"], content=str(tool_result), name=tc["name"]))
            
            # Observe tool results
            final_messages = messages + new_messages + [HumanMessage(content="Now that you have the tool results, output the final JSON or output 'HIGH_COST_REWRITE' to rewrite.")]
            final_res = perf_llm.invoke(final_messages)
            new_messages.append(final_res)
            
        return {"messages": new_messages, "iterations": iterations}

    def cost_check(state: GraphState) -> str:
        if state.get("iterations", 0) >= 2:
            return "end"
            
        messages = state.get("messages", [])
        if not messages: return "end"
        
        last_msg = messages[-1]
        if isinstance(last_msg, AIMessage) and isinstance(last_msg.content, str) and "HIGH_COST_REWRITE" in last_msg.content:
            if state.get("on_trace"): state["on_trace"]("↻ High cost detected. Triggering self-correction loop...")
            return "rewrite"
            
        return "end"

    workflow = StateGraph(GraphState)
    workflow.add_node("schema_analyst", schema_analyst)
    workflow.add_node("sql_generator", sql_generator)
    workflow.add_node("performance_optimizer", performance_optimizer)
    
    workflow.add_edge(START, "schema_analyst")
    workflow.add_edge("schema_analyst", "sql_generator")
    workflow.add_edge("sql_generator", "performance_optimizer")
    workflow.add_conditional_edges("performance_optimizer", cost_check, {
        "rewrite": "sql_generator",
        "end": END
    })
    
    return workflow.compile()
