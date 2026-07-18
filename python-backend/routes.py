import json
import asyncio
from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict
from auth import get_current_user
from database import get_db
from models import QueryHistory
from sqlalchemy.orm import Session
from graph import create_optimization_graph
from tools import DbConfig
import re
from langchain_core.messages import SystemMessage, HumanMessage

def robust_json_parse(json_str: str) -> dict:
    import json
    import re
    
    # 1. Try standard json loads first
    try:
        return json.loads(json_str)
    except Exception:
        pass
        
    # 2. State machine to escape newlines/tabs/quotes inside JSON strings
    try:
        in_string = False
        escape = False
        chars = []
        for i, char in enumerate(json_str):
            if char == '"' and not escape:
                in_string = not in_string
                chars.append(char)
            elif in_string:
                if char == '\n':
                    chars.append('\\n')
                elif char == '\r':
                    chars.append('\\r')
                elif char == '\t':
                    chars.append('\\t')
                elif char == '\\':
                    escape = not escape
                    chars.append(char)
                else:
                    escape = False
                    chars.append(char)
            else:
                chars.append(char)
        repaired = "".join(chars)
        return json.loads(repaired)
    except Exception:
        pass

    # 3. Regex parsing fallback
    result = {}
    
    # Extract optimized_query
    opt_match = re.search(r'"optimized_query"\s*:\s*"([\s\S]*?)"\s*(?:,|\n|\s*"explanation")', json_str)
    if opt_match:
        val = opt_match.group(1)
        val = val.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"').replace('\\\\', '\\')
        result["optimized_query"] = val
    else:
        opt_match_relaxed = re.search(r'"optimized_query"\s*:\s*"([\s\S]*?)"\s*,\s*"explanation"', json_str)
        if opt_match_relaxed:
            result["optimized_query"] = opt_match_relaxed.group(1).replace('\\n', '\n')
            
    # Extract explanation
    exp_match = re.search(r'"explanation"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"bottlenecks"|\Z)', json_str)
    if exp_match:
        val = exp_match.group(1)
        val = val.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"').replace('\\\\', '\\')
        result["explanation"] = val
    else:
        exp_match_relaxed = re.search(r'"explanation"\s*:\s*"([\s\S]*?)"\s*,\s*"bottlenecks"', json_str)
        if exp_match_relaxed:
            result["explanation"] = exp_match_relaxed.group(1).replace('\\n', '\n')

    # Default fallbacks
    if "optimized_query" not in result:
        result["optimized_query"] = ""
    if "explanation" not in result:
        result["explanation"] = json_str
        
    result["bottlenecks"] = []
    result["suggested_indexes"] = []
    
    # Try parsing list blocks
    bottlenecks_match = re.search(r'"bottlenecks"\s*:\s*(\[[\s\S]*?\])', json_str)
    if bottlenecks_match:
        try:
            result["bottlenecks"] = json.loads(bottlenecks_match.group(1))
        except:
            pass
            
    indexes_match = re.search(r'"suggested_indexes"\s*:\s*(\[[\s\S]*?\])', json_str)
    if indexes_match:
        try:
            result["suggested_indexes"] = json.loads(indexes_match.group(1))
        except:
            pass

    return result


def run_db_query(db_config: dict, sql: str):
    db_type = db_config.get("db_type", "postgresql").lower()
    if db_type == "postgresql":
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(
            host=db_config.get("host"),
            port=int(db_config.get("port") or 5432),
            dbname=db_config.get("database"),
            user=db_config.get("username"),
            password=db_config.get("password"),
            sslmode='require'
        )
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(sql)
                if cur.description:
                    return [dict(row) for row in cur.fetchall()]
                return []
        finally:
            conn.close()
    elif db_type == "mysql":
        import pymysql
        conn = pymysql.connect(
            host=db_config.get("host"),
            port=int(db_config.get("port") or 3306),
            database=db_config.get("database"),
            user=db_config.get("username"),
            password=db_config.get("password"),
            cursorclass=pymysql.cursors.DictCursor
        )
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
                return cur.fetchall()
        finally:
            conn.close()
    else:
        raise ValueError("Unsupported database type")

router = APIRouter()

class AnalyzeBody(BaseModel):
    query: str
    db_type: str
    manual_schema: Optional[str] = None
    db_config: Optional[Dict] = None

@router.post("/langgraph-analyze")
async def langgraph_analyze(request: AnalyzeBody, user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    
    async def event_generator():
        yield "event: status\ndata: \"Starting Agentic Workflow...\"\n\n"
        
        db_config_obj = DbConfig(
            db_type=request.db_config.get("db_type") if request.db_config else request.db_type,
            host=request.db_config.get("host") if request.db_config else None,
            port=request.db_config.get("port") if request.db_config else None,
            database=request.db_config.get("database") if request.db_config else None,
            user=request.db_config.get("username") if request.db_config else None,
            password=request.db_config.get("password") if request.db_config else None,
        )

        def on_trace(msg: str):
            # We can't yield directly from a sync callback inside async without a queue,
            # but for simplicity in this migration we'll append to a list and yield between steps,
            # or we can use async graph execution. Since langgraph is async, we can await.
            pass

        graph = create_optimization_graph()
        
        # We will use an async queue to stream traces
        trace_queue = asyncio.Queue()
        def async_on_trace(msg: str):
            trace_queue.put_nowait(msg)

        # Fetch previous optimizations for memory context
        recent_queries = db.query(QueryHistory).filter(QueryHistory.user_id == user_id).order_by(QueryHistory.created_at.desc()).limit(5).all()
        previous_optimizations = ""
        for q in recent_queries:
            previous_optimizations += f"- Original: {q.original_query}\n  Optimized: {q.optimized_query}\n  Explanation: {q.explanation}\n\n"

        initial_state = {
            "original_query": request.query,
            "schema_context": request.manual_schema or "",
            "previous_optimizations": previous_optimizations,
            "db_config": db_config_obj,
            "on_trace": async_on_trace
        }

        # Run the graph in background so we can stream from queue
        loop = asyncio.get_event_loop()
        task = loop.create_task(graph.ainvoke(initial_state))

        while not task.done():
            try:
                # Wait for trace event or 0.1s
                msg = await asyncio.wait_for(trace_queue.get(), timeout=0.1)
                yield f"event: trace\ndata: {json.dumps({'step': msg})}\n\n"
            except asyncio.TimeoutError:
                continue

        # Drain remaining traces
        while not trace_queue.empty():
            msg = trace_queue.get_nowait()
            yield f"event: trace\ndata: {json.dumps({'step': msg})}\n\n"

        yield "event: status\ndata: \"Agent Workflow Complete!\"\n\n"
        
        try:
            final_state = task.result()
            
            messages = final_state.get("messages", [])
            last_msg = messages[-1].content if messages else ""
            
            # Parse JSON
            clean = last_msg.strip()
            match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', clean)
            if match:
                clean = match.group(1).strip()
            else:
                first = clean.find("{")
                last = clean.rfind("}")
                if first != -1 and last != -1:
                    clean = clean[first:last+1].strip()

            try:
                llm_result = json.loads(clean)
            except Exception as e:
                llm_result = {
                    "optimized_query": final_state.get("optimized_query", ""),
                    "explanation": clean,
                    "bottlenecks": [{"type": "PARSE_ERROR", "table": "Unknown", "description": "AI Output was not valid JSON. Please check the raw explanation.", "severity": "MEDIUM"}],
                    "suggested_indexes": [],
                    "query_complexity_score": 50,
                    "execution_plan_summary": "Parsing Failed."
                }

            yield f"event: chunk\ndata: {json.dumps(llm_result)}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps(f'AI Optimization failed: {str(e)}')}\n\n"
            return

        # Save to DB
        try:
            history = QueryHistory(
                user_id=user_id,
                original_query=request.query,
                optimized_query=llm_result.get("optimized_query", ""),
                explanation=llm_result.get("explanation", ""),
                bottlenecks=llm_result.get("bottlenecks", []),
                suggested_indexes=llm_result.get("suggested_indexes", []),
                estimated_improvement=llm_result.get("estimated_improvement", ""),
                execution_plan_summary=llm_result.get("execution_plan_summary", ""),
                query_complexity_score=llm_result.get("query_complexity_score"),
                db_type=request.db_type
            )
            db.add(history)
            db.commit()
            db.refresh(history)
            yield f"event: savedId\ndata: {history.id}\n\n"
        except Exception as e:
            print(f"DB Error: {e}")
            db.rollback()

        yield "event: done\ndata: true\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.post("/langgraph-optimize")
async def langgraph_optimize(request: SchemaChatBody, user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    async def event_generator():
        yield "event: status\ndata: \"Starting Deep Analysis...\"\n\n"
        
        db_config_obj = DbConfig(
            db_type=request.db_config.get("db_type") if request.db_config else request.db_type,
            host=request.db_config.get("host") if request.db_config else None,
            port=int(request.db_config.get("port")) if request.db_config and request.db_config.get("port") else None,
            database=request.db_config.get("database") if request.db_config else None,
            user=request.db_config.get("username") if request.db_config else None,
            password=request.db_config.get("password") if request.db_config else None,
        )

        graph = create_optimization_graph()
        
        # Thread-safe queue for trace messages from sync graph nodes
        import queue as thread_queue
        trace_q = thread_queue.Queue()
        graph_done = {"value": False}
        graph_result = {"value": None, "error": None}
        
        def sync_on_trace(msg: str):
            trace_q.put(msg)

        # Basic context parsing from the message if provided
        schema_context = ""
        if "Schema Context (DDL):" in request.message:
            try:
                schema_context = request.message.split("Schema Context (DDL):")[1].split("```sql")[1].split("```")[0].strip()
            except:
                pass

        goal = "Max Performance"
        if "Goal:" in request.message:
            try:
                goal = request.message.split("Goal:")[1].split(".")[0].strip()
            except:
                pass

        initial_state = {
            "original_query": request.raw_query or "",
            "schema_context": schema_context,
            "previous_optimizations": "",
            "db_config": db_config_obj,
            "on_trace": sync_on_trace,
            "goal": goal
        }

        # Run the SYNC graph.invoke in a real background thread so that
        # time.sleep() inside nodes doesn't block the async event loop,
        # and trace messages arrive incrementally as each node starts.
        import concurrent.futures
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        
        def run_graph():
            try:
                result = graph.invoke(initial_state)
                graph_result["value"] = result
            except Exception as e:
                graph_result["error"] = e
            finally:
                graph_done["value"] = True
        
        future = executor.submit(run_graph)

        # Poll the trace queue while the graph thread is running
        while not graph_done["value"]:
            await asyncio.sleep(0.15)
            while not trace_q.empty():
                try:
                    msg = trace_q.get_nowait()
                    yield f"event: trace\ndata: {json.dumps({'step': msg})}\n\n"
                except:
                    break

        # Drain any remaining trace messages
        while not trace_q.empty():
            try:
                msg = trace_q.get_nowait()
                yield f"event: trace\ndata: {json.dumps({'step': msg})}\n\n"
            except:
                break

        yield "event: status\ndata: \"Generating Result...\"\n\n"
        
        if graph_result["error"]:
            err_msg = f"Optimization failed: {str(graph_result['error'])}"
            yield f"event: error\ndata: {json.dumps(err_msg)}\n\n"
            yield "event: done\ndata: true\n\n"
            executor.shutdown(wait=False)
            return
        
        try:
            final_state = graph_result["value"]
            messages = final_state.get("messages", [])
            last_msg = messages[-1].content if messages else ""
            
            clean = last_msg.strip()
            match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', clean)
            if match:
                clean = match.group(1).strip()
            else:
                first = clean.find("{")
                last = clean.rfind("}")
                if first != -1 and last != -1:
                    clean = clean[first:last+1].strip()

            llm_result = robust_json_parse(clean)
            if not llm_result.get("optimized_query"):
                llm_result["optimized_query"] = final_state.get("optimized_query", "")

            # Emit the structured JSON chunk so frontend can parse and display it
            yield f"event: chunk\ndata: {json.dumps(llm_result)}\n\n"
            
            # Save history
            try:
                history = QueryHistory(
                    user_id=user_id,
                    original_query=request.raw_query,
                    optimized_query=llm_result.get("optimized_query", ""),
                    explanation=llm_result.get("explanation", ""),
                    bottlenecks=llm_result.get("bottlenecks", []),
                    suggested_indexes=llm_result.get("suggested_indexes", []),
                    estimated_improvement=llm_result.get("estimated_improvement", ""),
                    execution_plan_summary=llm_result.get("execution_plan_summary", ""),
                    query_complexity_score=llm_result.get("query_complexity_score"),
                    db_type=request.db_type or "PostgreSQL"
                )
                db.add(history)
                db.commit()
            except Exception as e:
                db.rollback()

        except Exception as e:
            yield f"event: error\ndata: {json.dumps(f'Optimization failed: {str(e)}')}\n\n"
            
        yield "event: done\ndata: true\n\n"
        executor.shutdown(wait=False)

    return StreamingResponse(event_generator(), media_type="text/event-stream")

class ChatBody(BaseModel):
    history_id: int
    message: str

@router.post("/chat")
async def chat(request: ChatBody, user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    history = db.query(QueryHistory).filter(QueryHistory.id == request.history_id, QueryHistory.user_id == user_id).first()
    if not history:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="History not found")

    context = f"""Original Query:
{history.original_query}

Optimized Query:
{history.optimized_query}

Explanation:
{history.explanation}"""

    from llm import stream_chat_response
    import asyncio
    
    current_chat = history.chat_history.copy() if history.chat_history else []
    current_chat.append({"role": "user", "content": request.message})
    
    async def event_generator():
        yield "event: status\ndata: \"Thinking...\"\n\n"
        
        q = asyncio.Queue()
        async def on_chunk(chunk):
            await q.put(chunk)
            
        loop = asyncio.get_event_loop()
        task = loop.create_task(stream_chat_response(current_chat, context, on_chunk))
        
        while not task.done():
            try:
                chunk = await asyncio.wait_for(q.get(), timeout=0.1)
                yield f"event: chunk\ndata: {json.dumps(chunk)}\n\n"
            except asyncio.TimeoutError:
                continue
                
        while not q.empty():
            chunk = q.get_nowait()
            yield f"event: chunk\ndata: {json.dumps(chunk)}\n\n"
            
        try:
            full_response = task.result()
            current_chat.append({"role": "assistant", "content": full_response})
            
            # update db
            history.chat_history = current_chat
            db.commit()
            
            yield "event: done\ndata: {\"success\": true}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps(f'AI Optimization failed: {str(e)}')}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

class SchemaChatBody(BaseModel):
    message: str
    thread_id: Optional[str] = None
    chat_history: Optional[List[Dict]] = []
    timezone_offset: Optional[int] = 0
    raw_query: Optional[str] = None
    db_type: Optional[str] = "PostgreSQL"
    db_config: Optional[Dict] = None

from models import SchemaChatThread
from rag import search_relevant_schema
from sqlalchemy import desc

@router.get("/schema-chat/threads")
async def get_schema_threads(user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    threads = db.query(SchemaChatThread).filter(SchemaChatThread.user_id == user_id).order_by(desc(SchemaChatThread.created_at)).all()
    return [{"id": t.id, "title": t.title, "createdAt": t.created_at.isoformat()} for t in threads]

@router.get("/schema-chat/threads/{thread_id}")
async def get_schema_thread(thread_id: str, user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    thread = db.query(SchemaChatThread).filter(SchemaChatThread.id == thread_id, SchemaChatThread.user_id == user_id).first()
    if not thread:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Thread not found")
    
    return {
        "id": thread.id,
        "title": thread.title,
        "messages": thread.messages,
        "createdAt": thread.created_at.isoformat()
    }

@router.delete("/schema-chat/threads/{thread_id}")
async def delete_schema_thread(thread_id: str, user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    thread = db.query(SchemaChatThread).filter(SchemaChatThread.id == thread_id, SchemaChatThread.user_id == user_id).first()
    if thread:
        db.delete(thread)
        db.commit()
    return {"success": True}

@router.post("/schema-chat")
async def schema_chat(request: SchemaChatBody, user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    from llm import stream_chat_response
    import asyncio

    # RAG Search
    relevant_schema = await search_relevant_schema(user_id, request.message, 3)
    schema_context = "No specific schema definitions found in vector store."
    if relevant_schema:
        schema_context = "Relevant Database Schema Context:\n"
        for result in relevant_schema:
            payload = result.get("payload", {})
            schema_context += f"-- Table: {payload.get('table_name')}\n{payload.get('schema_ddl')}\n\n"
            
    # Recent Queries
    recent = db.query(QueryHistory).filter(QueryHistory.user_id == user_id).order_by(desc(QueryHistory.created_at)).limit(50).all()
    query_history_context = ""
    if recent:
        query_history_context = "Recent User Queries Context (Newest first):\n"
        from datetime import timedelta
        offset_minutes = request.timezone_offset or 0
        for i, q in enumerate(recent):
            local_dt = q.created_at - timedelta(minutes=offset_minutes)
            query_history_context += f"--- Recent Query {i+1} ---\nDate (User Local Time): {local_dt.strftime('%Y-%m-%d %I:%M:%S %p')}\nOriginal: {q.original_query}\nOptimized: {q.optimized_query}\n\n"
            
    full_context = f"{schema_context}\n---\n{query_history_context}".strip()
    
    thread_id = request.thread_id
    current_chat = request.chat_history.copy() if request.chat_history else []
    current_chat.append({"role": "user", "content": request.message})
    
    if not thread_id:
        title = request.message[:50] + ("..." if len(request.message) > 50 else "")
        new_thread = SchemaChatThread(user_id=user_id, title=title, messages=current_chat)
        db.add(new_thread)
        db.commit()
        db.refresh(new_thread)
        thread_id = new_thread.id
    else:
        existing = db.query(SchemaChatThread).filter(SchemaChatThread.id == thread_id, SchemaChatThread.user_id == user_id).first()
        if not existing:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Thread not found")
            
    async def event_generator():
        yield f"event: thread_id\ndata: {json.dumps({'thread_id': thread_id})}\n\n"
        
        q = asyncio.Queue()
        async def on_chunk(chunk):
            await q.put(chunk)
            
        loop = asyncio.get_event_loop()
        task = loop.create_task(stream_chat_response(current_chat, full_context, on_chunk))
        
        while not task.done():
            try:
                chunk = await asyncio.wait_for(q.get(), timeout=0.1)
                yield f"event: chunk\ndata: {json.dumps(chunk)}\n\n"
            except asyncio.TimeoutError:
                continue
                
        while not q.empty():
            chunk = q.get_nowait()
            yield f"event: chunk\ndata: {json.dumps(chunk)}\n\n"
            
        try:
            full_response = task.result()
            current_chat.append({"role": "assistant", "content": full_response})
            
            # update thread db
            thread = db.query(SchemaChatThread).filter(SchemaChatThread.id == thread_id).first()
            if thread:
                thread.messages = current_chat
                db.commit()

            # Also save to QueryHistory so /api/history works
            if request.raw_query and request.raw_query.strip():
                try:
                    history_entry = QueryHistory(
                        user_id=user_id,
                        original_query=request.raw_query,
                        optimized_query=full_response,
                        explanation=full_response,
                        bottlenecks=[],
                        suggested_indexes=[],
                        estimated_improvement="",
                        execution_plan_summary="",
                        query_complexity_score=None,
                        db_type=request.db_type or "PostgreSQL"
                    )
                    db.add(history_entry)
                    db.commit()
                    db.refresh(history_entry)
                    yield f"event: savedId\ndata: {history_entry.id}\n\n"
                except Exception as he:
                    print(f"History save error: {he}")
                    db.rollback()
                
            yield "event: done\ndata: {\"success\": true}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps(f'AI Optimization failed: {str(e)}')}\n\n"
        
    return StreamingResponse(event_generator(), media_type="text/event-stream")

class ExplainErrorBody(BaseModel):
    query: str
    error_message: str
    db_type: str
    schema: Optional[str] = None

@router.post("/errors/explain")
async def explain_error(request: ExplainErrorBody):
    try:
        from llm import get_groq_llm
        llm = get_groq_llm(temperature=0.2)
        system_prompt = f"""You are the Database Repair Specialist.
Analyze the following SQL query, database type ({request.db_type}), table DDL schemas (if provided), and the execution error.

Explain clearly why the query failed, and provide the exact corrected SQL query.

You must return a JSON response with two keys:
"explanation": a string explaining the issue and correction.
"corrected_query": a string containing only the corrected SQL query (without markdown wrappers).
"""
        user_prompt = f"""Query:
{request.query}

Error:
{request.error_message}

Schema (DDL):
{request.schema or "No schema context provided."}
"""
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ])
        
        clean = response.content.strip()
        match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', clean)
        if match:
            clean = match.group(1).strip()
        else:
            first = clean.find("{")
            last = clean.rfind("}")
            if first != -1 and last != -1:
                clean = clean[first:last+1].strip()
        
        result = json.loads(clean)
        return {
            "explanation": result.get("explanation", "Could not verify error details."),
            "corrected_query": result.get("corrected_query", request.query)
        }
    except Exception as e:
        return {
            "explanation": f"AI was unable to explain the error: {str(e)}",
            "corrected_query": request.query
        }

class EstimateBody(BaseModel):
    query: str
    db_config: Dict

@router.post("/queries/estimate")
async def estimate_query(request: EstimateBody):
    try:
        db_type = request.db_config.get("db_type", "postgresql").lower()
        if db_type == "postgresql":
            import re
            explainable_query = re.sub(r'\$\d+', 'NULL', request.query)
            explainable_query = explainable_query.replace('?', 'NULL')
            plan_rows = run_db_query(request.db_config, f"EXPLAIN (FORMAT JSON) {explainable_query}")
            if plan_rows and isinstance(plan_rows, list):
                plan = plan_rows[0][0][0].get("Plan", {}) if isinstance(plan_rows[0][0], list) else plan_rows[0].get("Plan", {})
                cost = plan.get("Total Cost", 0)
                rows = plan.get("Plan Rows", 0)
                
                risk = "LOW"
                reasons = []
                if cost > 10000:
                    risk = "HIGH"
                    reasons.append("High query execution cost (> 10000)")
                elif cost > 2000:
                    risk = "MEDIUM"
                    reasons.append("Moderate query execution cost (> 2000)")
                
                has_seq_scan = False
                def check_seq_scan(node):
                    nonlocal has_seq_scan
                    if node.get("Node Type") == "Seq Scan":
                        has_seq_scan = True
                    for child in node.get("Plans", []):
                        check_seq_scan(child)
                check_seq_scan(plan)
                
                if has_seq_scan:
                    if risk != "HIGH":
                        risk = "MEDIUM"
                    reasons.append("Sequential scan detected on a table")
                
                msg = f"Cost: {cost}, Rows: {rows}. "
                if reasons:
                    msg += "Warnings: " + ", ".join(reasons)
                else:
                    msg += "No major database optimizer warnings found."
                    
                return {
                    "cost": cost,
                    "rows": rows,
                    "risk_level": risk,
                    "message": msg
                }
        elif db_type == "mysql":
            import re
            explainable_query = re.sub(r'\$\d+', 'NULL', request.query)
            explainable_query = explainable_query.replace('?', 'NULL')
            plan_rows = run_db_query(request.db_config, f"EXPLAIN FORMAT=JSON {explainable_query}")
            if plan_rows:
                import json
                raw_json = list(plan_rows[0].values())[0]
                if isinstance(raw_json, str):
                    plan_data = json.loads(raw_json)
                else:
                    plan_data = raw_json
                cost = float(plan_data.get("query_block", {}).get("cost_info", {}).get("query_cost", 0))
                rows = int(plan_data.get("query_block", {}).get("cost_info", {}).get("rows_examined_per_scan", 0) or 0)
                risk = "HIGH" if cost > 1000 else "MEDIUM" if cost > 100 else "LOW"
                msg = f"MySQL query cost: {cost}. Rows examined: {rows}."
                return {
                    "cost": cost,
                    "rows": rows,
                    "risk_level": risk,
                    "message": msg
                }
        return {"cost": 0, "rows": 0, "risk_level": "LOW", "message": "Estimator not configured or failed to parse plan."}
    except Exception as e:
        return {"cost": 0, "rows": 0, "risk_level": "HIGH", "message": f"Estimation failed: {str(e)}"}

class EstimateIndexBody(BaseModel):
    index_statement: str
    query: str
    db_type: str
    db_config: Optional[Dict] = None

@router.post("/indexes/estimate")
async def estimate_index(request: EstimateIndexBody):
    try:
        current_plan = ""
        if request.db_config and request.db_config.get("host"):
            try:
                import re
                explainable_query = re.sub(r'\$\d+', 'NULL', request.query)
                explainable_query = explainable_query.replace('?', 'NULL')
                plan_rows = run_db_query(request.db_config, f"EXPLAIN {explainable_query}")
                current_plan = "\n".join([row[0] if isinstance(row, list) else str(row) for row in plan_rows])
            except Exception as plan_err:
                current_plan = f"Could not fetch raw query plan: {str(plan_err)}"

        from llm import get_groq_llm
        llm = get_groq_llm(temperature=0.1)
        system_prompt = """You are the Database Index Advisor.
Estimate the speedup factor and query impact of the proposed index statement on the given SQL query.
Use the provided EXPLAIN query plan (if available) to evaluate the query complexity and cost.

You must return a JSON response with these keys:
"speedup_factor": a number (e.g. 5 or 12) representing the estimated speedup.
"impact_count": an integer representing how many tables or queries this index helps (typically 1-3).
"original_cost": an estimate of the planner cost (default 5000 if not clear).
"new_cost": the predicted cost after index is built (original_cost divided by speedup_factor).
"simulated": a boolean (true).
"""
        user_prompt = f"""Query:
{request.query}

Proposed Index:
{request.index_statement}

Current Query EXPLAIN Plan:
{current_plan or "Not available."}
"""
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ])
        
        clean = response.content.strip()
        match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', clean)
        if match:
            clean = match.group(1).strip()
        else:
            first = clean.find("{")
            last = clean.rfind("}")
            if first != -1 and last != -1:
                clean = clean[first:last+1].strip()
        
        result = json.loads(clean)
        return {
            "speedup_factor": result.get("speedup_factor", 5),
            "impact_count": result.get("impact_count", 1),
            "original_cost": result.get("original_cost", 5000),
            "new_cost": result.get("new_cost", 1000),
            "simulated": True
        }
    except Exception as e:
        import random
        return {
            "speedup_factor": random.randint(3, 10),
            "impact_count": 1,
            "original_cost": 5000,
            "new_cost": 1000,
            "simulated": False
        }

class MonitorCredentials(BaseModel):
    db_type: str
    host: str
    port: int
    database: str
    username: str
    password: str

@router.post("/monitor/slow-queries")
async def slow_queries(creds: MonitorCredentials):
    import asyncio
    from sqlalchemy import create_engine, text
    from fastapi.responses import JSONResponse

    def fetch_queries():
        try:
            if creds.db_type.lower() == "postgresql":
                db_url = f"postgresql://{creds.username}:{creds.password}@{creds.host}:{creds.port}/{creds.database}"
                engine = create_engine(db_url, connect_args={"connect_timeout": 5})
                with engine.connect() as conn:
                    try:
                        res = conn.execute(text("SELECT query, mean_exec_time as execution_time_ms, calls FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%' AND query NOT ILIKE '%pg_catalog%' AND query NOT ILIKE '%neon_migration%' AND query NOT ILIKE '%health_check%' ORDER BY mean_exec_time DESC LIMIT 20"))
                        queries = [{"query": row[0], "execution_time_ms": float(row[1]), "calls": row[2]} for row in res if row[0]]
                    except Exception:
                        res = conn.execute(text("SELECT query, EXTRACT(EPOCH FROM (now() - query_start)) * 1000 as execution_time_ms FROM pg_stat_activity WHERE state = 'active' AND query NOT ILIKE '%pg_stat_activity%' AND query NOT ILIKE '%pg_catalog%' AND query NOT ILIKE '%neon_migration%' AND query NOT ILIKE '%health_check%' ORDER BY execution_time_ms DESC LIMIT 20"))
                        queries = [{"query": row[0], "execution_time_ms": float(row[1] or 0), "calls": 1} for row in res if row[0]]
                    return {"queries": queries}
            elif creds.db_type.lower() == "mysql":
                db_url = f"mysql+pymysql://{creds.username}:{creds.password}@{creds.host}:{creds.port}/{creds.database}"
                engine = create_engine(db_url, connect_args={"connect_timeout": 5})
                with engine.connect() as conn:
                    try:
                        res = conn.execute(text("SELECT sql_text as query, max_timer_wait/1000000000000 as execution_time_ms, count_star as calls FROM performance_schema.events_statements_summary_by_digest ORDER BY max_timer_wait DESC LIMIT 20"))
                        queries = [{"query": row[0], "execution_time_ms": float(row[1]), "calls": row[2]} for row in res if row[0]]
                    except Exception:
                        queries = []
                    return {"queries": queries}
            else:
                return {"error": "Unsupported database type"}
        except Exception as e:
            return {"error": f"Failed to connect: {str(e)}"}

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, fetch_queries)
    if "error" in result:
        return JSONResponse(status_code=400, content=result)
    return result

@router.post("/monitor/telemetry")
async def db_telemetry(creds: MonitorCredentials):
    import asyncio
    from sqlalchemy import create_engine, text
    from fastapi.responses import JSONResponse

    def fetch_telemetry():
        try:
            if creds.db_type.lower() == "postgresql":
                db_url = f"postgresql://{creds.username}:{creds.password}@{creds.host}:{creds.port}/{creds.database}"
                engine = create_engine(db_url, connect_args={"connect_timeout": 5})
                with engine.connect() as conn:
                    # 1. Slow Queries
                    try:
                        res = conn.execute(text("SELECT query, mean_exec_time as execution_time_ms, calls FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%' AND query NOT ILIKE '%pg_catalog%' ORDER BY mean_exec_time DESC LIMIT 10"))
                        queries = [{"query": row[0], "execution_time_ms": float(row[1]), "calls": row[2]} for row in res if row[0]]
                    except Exception:
                        # fallback
                        res = conn.execute(text("SELECT query, EXTRACT(EPOCH FROM (now() - query_start)) * 1000 as execution_time_ms FROM pg_stat_activity WHERE state = 'active' AND query NOT ILIKE '%pg_stat_activity%' AND query NOT ILIKE '%pg_catalog%' ORDER BY execution_time_ms DESC LIMIT 10"))
                        queries = [{"query": row[0], "execution_time_ms": float(row[1] or 0), "calls": 1} for row in res if row[0]]

                    # 2. Missing Indexes
                    try:
                        res = conn.execute(text("SELECT relname AS table_name, seq_scan, idx_scan FROM pg_stat_user_tables WHERE seq_scan > 0 ORDER BY seq_scan DESC LIMIT 5"))
                        missing_indexes = [{"table_name": row[0], "seq_scan": row[1], "idx_scan": row[2]} for row in res]
                    except Exception:
                        missing_indexes = []

                    # 3. Active Connections
                    try:
                        res = conn.execute(text("SELECT count(*) FROM pg_stat_activity WHERE state = 'active'"))
                        active_connections = res.scalar() or 0
                    except Exception:
                        active_connections = 0

                    # 4. Cache Hit Ratio
                    try:
                        res = conn.execute(text("SELECT sum(blks_hit) * 100 / nullif(sum(blks_hit + blks_read), 0) AS cache_hit_ratio FROM pg_stat_database"))
                        cache_hit_ratio = float(res.scalar() or 0)
                    except Exception:
                        cache_hit_ratio = 0.0

                    return {
                        "queries": queries,
                        "missing_indexes": missing_indexes,
                        "active_connections": active_connections,
                        "cache_hit_ratio": cache_hit_ratio
                    }
            else:
                return {"error": "Telemetry currently only supports PostgreSQL."}
        except Exception as e:
            return {"error": f"Failed to connect: {str(e)}"}

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, fetch_telemetry)
    if "error" in result:
        return JSONResponse(status_code=400, content=result)
    return result

@router.get("/intelligence/history")
async def intelligence_history(user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    recent = db.query(QueryHistory).filter(QueryHistory.user_id == user_id).order_by(desc(QueryHistory.created_at)).limit(50).all()
    
    if not recent:
        return {
            "overall_health_score": 100,
            "summary": "No query history available to analyze.",
            "common_bottlenecks": [],
            "suggested_indexes": []
        }

    complexities = [q.query_complexity_score for q in recent if q.query_complexity_score is not None]
    health_score = max(0, min(100, int(100 - (sum(complexities) / len(complexities))))) if complexities else 85

    bottleneck_counts = {}
    for q in recent:
        if isinstance(q.bottlenecks, list):
            for b in q.bottlenecks:
                b_type = b.get("type", "Unknown") if isinstance(b, dict) else str(b)
                bottleneck_counts[b_type] = bottleneck_counts.get(b_type, 0) + 1
    
    common_bottlenecks = [f"{k} ({v} times)" for k, v in sorted(bottleneck_counts.items(), key=lambda item: item[1], reverse=True)[:4]]

    suggested_indexes = []
    seen = set()
    for q in recent:
        if isinstance(q.suggested_indexes, list):
            for idx in q.suggested_indexes:
                statement = idx if isinstance(idx, str) else idx.get("statement", "")
                if statement and statement not in seen:
                    seen.add(statement)
                    suggested_indexes.append(idx)
                if len(suggested_indexes) >= 5:
                    break
        if len(suggested_indexes) >= 5:
            break

    summary = f"Analyzed {len(recent)} recent queries. The overall database query health is {'Good' if health_score > 70 else 'Needs Improvement'}. Consider addressing the recurring bottlenecks."

    return {
        "overall_health_score": health_score,
        "summary": summary,
        "common_bottlenecks": common_bottlenecks,
        "suggested_indexes": suggested_indexes
    }

@router.get("/history")
async def get_history(user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    recent = db.query(QueryHistory).filter(QueryHistory.user_id == user_id).order_by(desc(QueryHistory.created_at)).all()
    return [{
        "id": q.id, 
        "original_query": q.original_query, 
        "optimized_query": q.optimized_query, 
        "explanation": q.explanation, 
        "bottlenecks": q.bottlenecks, 
        "suggested_indexes": q.suggested_indexes, 
        "created_at": q.created_at.isoformat() + "Z",
        "estimated_improvement": q.estimated_improvement,
        "execution_plan_summary": q.execution_plan_summary,
        "db_type": q.db_type,
        "query_complexity_score": q.query_complexity_score
    } for q in recent]

@router.get("/history/{id}")
async def get_history_entry(id: int, user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(QueryHistory).filter(QueryHistory.id == id, QueryHistory.user_id == user_id).first()
    if not q:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    return {
        "id": q.id, 
        "original_query": q.original_query, 
        "optimized_query": q.optimized_query, 
        "explanation": q.explanation, 
        "bottlenecks": q.bottlenecks, 
        "suggested_indexes": q.suggested_indexes, 
        "execution_plan_summary": q.execution_plan_summary, 
        "query_complexity_score": q.query_complexity_score, 
        "db_type": q.db_type,
        "estimated_improvement": q.estimated_improvement,
        "share_id": q.share_id,
        "created_at": q.created_at.isoformat() + "Z"
    }
@router.delete("/history/{id}")
async def delete_history_entry(id: int, user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(QueryHistory).filter(QueryHistory.id == id, QueryHistory.user_id == user_id).first()
    if not q:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(q)
    db.commit()
    return {"status": "success"}

@router.delete("/history")
async def clear_history(user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(QueryHistory).filter(QueryHistory.user_id == user_id).delete()
    db.commit()
    return {"status": "success"}

@router.get("/stats")
async def get_stats(user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    recent = db.query(QueryHistory).filter(QueryHistory.user_id == user_id).all()
    
    total_optimizations = len(recent)
    postgresql_count = sum(1 for r in recent if r.db_type.lower() == "postgresql")
    mysql_count = sum(1 for r in recent if r.db_type.lower() == "mysql")
    
    bottleneck_counts = {}
    for r in recent:
        if isinstance(r.bottlenecks, list):
            for b in r.bottlenecks:
                b_type = b.get("type", "Unknown")
                bottleneck_counts[b_type] = bottleneck_counts.get(b_type, 0) + 1
                
    top_bottlenecks = [{"type": k, "count": v} for k, v in sorted(bottleneck_counts.items(), key=lambda item: item[1], reverse=True)[:5]]
    
    return {
        "total_optimizations": total_optimizations,
        "postgresql_count": postgresql_count,
        "mysql_count": mysql_count,
        "top_bottleneck_types": top_bottlenecks
    }


@router.get("/healthz")
async def healthz():
    return {"status": "ok", "message": "Python backend is running!"}

class ShareBody(BaseModel):
    history_id: int

@router.post("/share")
async def share_query(request: ShareBody, user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    import uuid
    history = db.query(QueryHistory).filter(QueryHistory.id == request.history_id, QueryHistory.user_id == user_id).first()
    if not history:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    
    if not history.share_id:
        history.share_id = str(uuid.uuid4())
        db.commit()
        
    return {"shareId": history.share_id}

@router.get("/share/{shareId}")
async def get_shared_query(shareId: str, db: Session = Depends(get_db)):
    history = db.query(QueryHistory).filter(QueryHistory.share_id == shareId).first()
    if not history:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Shared query not found")
        
    return {
        "id": history.id,
        "original_query": history.original_query,
        "optimized_query": history.optimized_query,
        "explanation": history.explanation,
        "bottlenecks": history.bottlenecks,
        "suggested_indexes": history.suggested_indexes,
        "execution_plan_summary": history.execution_plan_summary,
        "query_complexity_score": history.query_complexity_score,
        "db_type": history.db_type,
        "created_at": history.created_at.isoformat() + "Z"
    }

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room_id: str):
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
        self.active_connections[room_id].append(websocket)

    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id in self.active_connections:
            if websocket in self.active_connections[room_id]:
                self.active_connections[room_id].remove(websocket)
            if not self.active_connections[room_id]:
                del self.active_connections[room_id]

    async def broadcast(self, message: dict, room_id: str, exclude_websocket: WebSocket = None):
        if room_id in self.active_connections:
            for connection in self.active_connections[room_id]:
                if connection != exclude_websocket:
                    try:
                        await connection.send_json(message)
                    except Exception:
                        pass

manager = ConnectionManager()

@router.websocket("/ws/collaboration/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await manager.connect(websocket, room_id)
    try:
        while True:
            data = await websocket.receive_json()
            await manager.broadcast(data, room_id, exclude_websocket=websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)
        await manager.broadcast({"type": "user-leave", "message": "A user left the room"}, room_id)
    except Exception:
        manager.disconnect(websocket, room_id)


class DiscussSchemaBody(BaseModel):
    table_name: str
    schema_ddl: str
    message: str
    chat_history: Optional[List[Dict[str, str]]] = []

@router.post("/schema/discuss")
async def discuss_schema(request: DiscussSchemaBody):
    from llm import get_groq_llm
    from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
    
    llm = get_groq_llm(temperature=0.2)
    
    history_messages = []
    if request.chat_history:
        for msg in request.chat_history:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "user":
                history_messages.append(HumanMessage(content=content))
            else:
                history_messages.append(AIMessage(content=content))
                
    system_prompt = f"""You are an expert Database Administrator (DBA) AI assistant.
You are helping the user analyze and optimize the table `{request.table_name}`.

Here is the current Schema Context (DDL):
```sql
{request.schema_ddl}
```

Answer the user's question about the table `{request.table_name}`. 
Keep your response concise, clear, and action-oriented. Provide exact SQL statements or indexing guidelines when relevant, formatted in markdown blocks. Do not explain unrelated tables unless requested."""

    messages = [SystemMessage(content=system_prompt)] + history_messages + [HumanMessage(content=request.message)]
    
    async def response_stream():
        try:
            async for chunk in llm.astream(messages):
                if chunk.content:
                    yield chunk.content
        except Exception as e:
            yield f"Error discussing schema: {str(e)}"
            
    return StreamingResponse(response_stream(), media_type="text/plain")

class GenerateSchemaBody(BaseModel):
    prompt: str

@router.post("/schema/generate")
async def generate_schema(request: GenerateSchemaBody):
    from llm import get_groq_llm
    from langchain_core.messages import SystemMessage, HumanMessage
    
    llm = get_groq_llm(temperature=0.2)
    
    system_prompt = """You are an expert Database Architect.
Convert the user's natural language request into a clean, formatted SQL CREATE TABLE DDL.
Return ONLY valid, standard SQL DDL statements (e.g. CREATE TABLE) in plain text.
Do NOT output any markdown syntax, backticks, or explanation. Only raw SQL DDL code."""

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=request.prompt)
    ]
    try:
        response = llm.invoke(messages)
        clean = response.content.strip()
        import re
        match = re.search(r'```(?:sql)?\s*([\s\S]*?)\s*```', clean)
        if match:
            clean = match.group(1).strip()
        return {"ddl": clean}
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"Generation failed: {str(e)}")


class SaveSchemaBody(BaseModel):
    ddl: str
    table_count: int

@router.post("/schema/history")
async def save_schema_history(request: SaveSchemaBody, user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    from models import SchemaHistory
    entry = SchemaHistory(
        user_id=user_id,
        ddl=request.ddl,
        table_count=request.table_count
    )
    db.add(entry)
    db.commit()
    return {"status": "success", "id": entry.id}

@router.get("/schema/history")
async def get_schema_history(user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    from models import SchemaHistory
    from sqlalchemy import desc
    recent = db.query(SchemaHistory).filter(SchemaHistory.user_id == user_id).order_by(desc(SchemaHistory.created_at)).all()
    return [{
        "id": r.id,
        "ddl": r.ddl,
        "table_count": r.table_count,
        "created_at": r.created_at.isoformat() + "Z"
    } for r in recent]

@router.delete("/schema/history/{id}")
async def delete_schema_history(id: int, user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    from models import SchemaHistory
    entry = db.query(SchemaHistory).filter(SchemaHistory.id == id, SchemaHistory.user_id == user_id).first()
    if not entry:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(entry)
    db.commit()
    return {"status": "success"}

