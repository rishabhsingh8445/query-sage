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
    previous_optimizations: str
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
        db_config = state.get("db_config")
        if not db_config or not db_config.host:
            if state.get("on_trace"): state["on_trace"]("✓ Fast-Path: Skipping Schema Analyst (Manual Mode)")
            return {"messages": []}
            
        if state.get("on_trace"): state["on_trace"]("✓ Analyzing Schema (Schema Analyst)")
        
        tools_list = create_tools(state.get("db_config"), state.get("on_trace"))
        schema_tools = [t for t in tools_list if t.name in ["get_schema", "get_indexes", "get_foreign_keys"]]
        
        analyst_llm = llm.bind_tools(schema_tools)
        
        messages = [
            SystemMessage(content="You are the Schema Analyst. Fetch schema/indexes/foreign_keys for tables mentioned in the query. Call tools if needed. Return a short summary of schema."),
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
        
        feedback = ""
        messages = state.get("messages", [])
        if messages and state.get("iterations", 0) > 0:
            feedback = f"\n\nReviewer Feedback from previous iteration:\n{messages[-1].content}"
            
        mem = state.get("previous_optimizations", "")
        memory_prompt = f"\n\nPrevious Optimizations Memory:\n{mem}" if mem else ""

        sys_msg = SystemMessage(content="You are the SQL Generator. Rewrite the original query to be more optimized based on the schema and previous findings. Return ONLY the rewritten SQL query in plain text, without markdown blocks.")
        human_msg = HumanMessage(content=f"Original Query:\n{state.get('original_query')}\n\nSchema Context:\n{state.get('schema_context')}{memory_prompt}{feedback}")
        
        res = llm.invoke([sys_msg, human_msg])
        
        optimized = res.content.strip()
        if optimized.startswith("```"):
            optimized = optimized.split("```")[1]
            if optimized.startswith("sql\n"):
                optimized = optimized[4:]
            optimized = optimized.strip()
            
        return {"optimized_query": optimized, "messages": [res]}

    def performance_optimizer(state: GraphState):
        iterations = state.get("iterations", 0) + 1
        db_config = state.get("db_config")
        
        if not db_config or not db_config.host:
            if state.get("on_trace"): state["on_trace"](f"✓ Fast-Path: Conceptual Analysis (Iteration {iterations})")
            return {"iterations": iterations, "messages": [AIMessage(content="No live DB. Conceptual analysis only.")]}

        if state.get("on_trace"): state["on_trace"](f"✓ Evaluating Cost (Performance Optimizer) - Iteration {iterations}")
        
        tools_list = create_tools(state.get("db_config"), state.get("on_trace"))
        perf_tools = [t for t in tools_list if t.name in ["run_explain", "analyze_cost", "optimize_indexes"]]
        
        perf_llm = llm.bind_tools(perf_tools)
        
        messages = [
            SystemMessage(content="You are the Performance Optimizer. Use 'run_explain' to test the Optimized Query against the database. Use 'optimize_indexes' to suggest an index if needed. Return a summary of the execution plan and cost. Do not output the final JSON yet."),
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
            
            final_res = llm.invoke(messages + new_messages + [HumanMessage(content="Summarize the performance findings and tools results.")])
            new_messages.append(final_res)
            
        return {"messages": new_messages, "iterations": iterations}

    def reviewer(state: GraphState):
        iterations = state.get("iterations", 1)
        if state.get("on_trace"): state["on_trace"](f"✓ Validating (Reviewer Agent) - Iteration {iterations}")
        
        messages = state.get("messages", [])
        perf_output = messages[-1].content if messages else "No performance data."
        
        sys_msg = SystemMessage(content='''You are the Reviewer Agent. 
1. Review the performance data. 
2. If the query is fundamentally flawed, slow, or incorrect, return the exact phrase "HIGH_COST_REWRITE" followed by a detailed reason why it failed so the generator can learn.
3. Otherwise, return a JSON block EXACTLY matching this structure:
{
  "optimized_query": "<the final rewritten SQL>",
  "explanation": "<detailed explanation of changes>",
  "bottlenecks": [{"type": "SEQ_SCAN", "table": "...", "description": "...", "severity": "HIGH"}],
  "suggested_indexes": [{"statement": "CREATE INDEX...", "reason": "..."}],
  "estimated_improvement": "...",
  "execution_plan_summary": "...",
  "query_complexity_score": 85
}''')
        human_prompt = f"Original Query:\n{state.get('original_query')}\n\nOptimized Query:\n{state.get('optimized_query')}\n\nPerformance Output:\n{perf_output}"
        
        if iterations >= 2:
            human_prompt += "\n\nThis is the final iteration. You MUST output the JSON EXACTLY as requested and YOU CANNOT use 'HIGH_COST_REWRITE'."
            
        res = llm.invoke([sys_msg, HumanMessage(content=human_prompt)])
        return {"messages": [res]}

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
    workflow.add_node("reviewer", reviewer)
    
    workflow.add_edge(START, "schema_analyst")
    workflow.add_edge("schema_analyst", "sql_generator")
    workflow.add_edge("sql_generator", "performance_optimizer")
    workflow.add_edge("performance_optimizer", "reviewer")
    workflow.add_conditional_edges("reviewer", cost_check, {
        "rewrite": "sql_generator",
        "end": END
    })
    
    return workflow.compile()
