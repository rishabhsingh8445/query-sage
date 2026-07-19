import os
import time
import json
from typing import TypedDict, Annotated, Sequence
from operator import add
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage, ToolMessage, AIMessage
from langgraph.graph import StateGraph, START, END
from llm import get_groq_llm
from tools import create_tools, DbConfig

class GraphState(TypedDict):
    original_query: str
    schema_context: str
    previous_optimizations: str
    messages: Annotated[list[BaseMessage], add]
    optimized_query: str
    iterations: int
    complexity_score: int
    db_config: DbConfig
    on_trace: any
    goal: str

def create_optimization_graph():
    
    llm = get_groq_llm(temperature=0.1)

    def query_parser(state: GraphState):
        query = state.get("original_query", "").upper()
        
        score = 1
        score += query.count("JOIN") * 2
        score += query.count("WITH") * 3
        score += query.count("GROUP BY") * 2
        score += query.count("OVER") * 2
        if len(query) > 200: score += 1
        
        return {"complexity_score": score}

    def schema_analyst(state: GraphState):
        on_trace = state.get("on_trace")
        if on_trace: on_trace("Analyzing Schema & Indexes...")
        db_config = state.get("db_config")
        has_db = db_config and db_config.host
        
        if has_db:
            tools_list = create_tools(db_config, state.get("on_trace"))
            schema_tools = [t for t in tools_list if t.name in ["get_schema", "get_indexes", "get_foreign_keys"]]
            analyst_llm = llm.bind_tools(schema_tools)
        else:
            schema_tools = []
            analyst_llm = llm
        
        messages = [
            SystemMessage(content="You are the Schema Analyst. If you have tools, fetch schema/indexes for tables mentioned. Otherwise, analyze the provided Existing Schema and summarize its structure. Return a short summary of schema."),
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
        on_trace = state.get("on_trace")
        if on_trace: on_trace("Generating Optimized SQL...")
        feedback = ""
        messages = state.get("messages", [])
        if messages and state.get("iterations", 0) > 0:
            feedback = f"\n\nReviewer Feedback from previous iteration:\n{messages[-1].content}"
            
        mem = state.get("previous_optimizations", "")
        memory_prompt = f"\n\nPrevious Optimizations Memory:\n{mem}" if mem else ""

        goal = state.get("goal", "Max Performance")
        if goal == "Format & Lint Only":
            sys_msg = SystemMessage(content="You are the SQL Generator. Rewrite the original query ONLY to format and lint it (proper indentation, uppercase keywords, standard spacing). Do NOT change its execution logic, join structures, subqueries, or filter predicates. Return ONLY the formatted SQL query in plain text, without markdown blocks.")
        elif goal == "Low CPU/Memory":
            sys_msg = SystemMessage(content="You are the SQL Generator. Rewrite the original query to prioritize low CPU usage and memory footprint (avoid nested joins, reduce temp tables, avoid heavy subqueries). Return ONLY the rewritten SQL query in plain text, without markdown blocks.")
        else:
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
        on_trace = state.get("on_trace")
        if on_trace: on_trace("Evaluating Cost & Performance...")
        iterations = state.get("iterations", 0) + 1
        db_config = state.get("db_config")
        has_db = db_config and db_config.host
        
        if has_db:
            tools_list = create_tools(db_config, state.get("on_trace"))
            perf_tools = [t for t in tools_list if t.name in ["run_explain", "analyze_cost", "optimize_indexes"]]
            perf_llm = llm.bind_tools(perf_tools)
        else:
            perf_tools = []
            perf_llm = llm
        
        messages = [
            SystemMessage(content="You are the Performance Optimizer. Evaluate the cost and performance of the Optimized Query. If no tools are available, do a conceptual analysis of potential bottlenecks (e.g. missing indexes on JOIN columns). Return a summary of the execution plan and cost."),
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
        on_trace = state.get("on_trace")
        if on_trace: on_trace("Validating & Reviewing Final Output...")
        iterations = state.get("iterations", 1)
        messages = state.get("messages", [])
        perf_output = messages[-1].content if messages else "No performance data."
        goal = state.get("goal", "Max Performance")
        
        sys_msg = SystemMessage(content=f'''You are the Lead Database Administrator and Senior Reviewer Agent.
1. Review the performance cost and schema context based on the selected goal: "{goal}".
2. If the goal is "Format & Lint Only", do NOT reject with "HIGH_COST_REWRITE". Just validate the formatting.
3. If the goal is "Max Performance" or "Low CPU/Memory", and the query is fundamentally flawed, slow, or incorrect, you can return "HIGH_COST_REWRITE" followed by a detailed reason why it failed.
4. Otherwise, you MUST return a JSON block matching this structure:
{{
  "optimized_query": "<the final rewritten SQL query, formatted nicely>",
  "explanation": "# 📊 QUERY PERFORMANCE OPTIMIZATION REPORT\\n\\n### 1. Executive Summary\\n- **Initial Complexity:** <Describe initial query complexity, referencing tables/joins>\\n- **Primary Issue:** <State main issue, e.g., nested subqueries, unindexed join scans>\\n- **Estimated Speedup:** <Estimated speedup multiplier, e.g. 5x-10x improvement>\\n\\n### 2. Identified Bottlenecks\\n- ⚠️ **[Bottleneck 1]** - <Describe table scan or filter issue in detail, referencing exact columns>\\n- ⚠️ **[Bottleneck 2]** - <Describe join or group by bottleneck>\\n\\n### 3. Applied Optimizations\\n- **[Optimization 1]** - <Describe the specific SQL rewrite done (like CTE elimination or aggregate simplification) and why it improves speed>\\n- **[Optimization 2]** - <Describe another change like removing correlated subqueries or using window functions optimally>\\n\\n### 4. Architectural Impact\\n- <Explain how these changes affect temporary tables, memory usage, and CPU cycles in professional DBA terms>\\n",
  "bottlenecks": [{{"type": "SEQ_SCAN", "table": "...", "description": "...", "severity": "HIGH"}}],
  "suggested_indexes": [{{"statement": "CREATE INDEX...", "reason": "..."}}],
  "estimated_improvement": "...",
  "execution_plan_summary": "...",
  "query_complexity_score": 85
}}
Make sure all text under "explanation" is written in professional DBA terminology, referencing exact table names and column names from the input query. Keep the tone technical, clean, and highly details-oriented.''')
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
    workflow.add_node("query_parser", query_parser)
    workflow.add_node("schema_analyst", schema_analyst)
    workflow.add_node("sql_generator", sql_generator)
    workflow.add_node("performance_optimizer", performance_optimizer)
    workflow.add_node("reviewer", reviewer)
    
    workflow.add_edge(START, "query_parser")
    workflow.add_edge("query_parser", "schema_analyst")
    workflow.add_edge("schema_analyst", "sql_generator")
    workflow.add_edge("sql_generator", "performance_optimizer")
    workflow.add_edge("performance_optimizer", "reviewer")
    workflow.add_conditional_edges("reviewer", cost_check, {
        "rewrite": "sql_generator",
        "end": END
    })
    
    return workflow.compile()
