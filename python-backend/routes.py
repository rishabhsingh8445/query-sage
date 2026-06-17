import json
import asyncio
from fastapi import APIRouter, Depends, Request
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

        initial_state = {
            "original_query": request.query,
            "schema_context": request.manual_schema or "",
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
            yield f"event: error\ndata: {json.dumps(f'AI Chat failed: {str(e)}')}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

class SchemaChatBody(BaseModel):
    message: str
    thread_id: Optional[str] = None
    chat_history: Optional[List[Dict]] = []

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
        query_history_context = "Recent User Queries Context:\n"
        for i, q in enumerate(recent):
            query_history_context += f"[Query {i+1} Date]: {q.created_at}\n[Query {i+1} Original]: {q.original_query}\n[Query {i+1} Optimized]: {q.optimized_query}\n\n"
            
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
            
            # update db
            thread = db.query(SchemaChatThread).filter(SchemaChatThread.id == thread_id).first()
            if thread:
                thread.messages = current_chat
                db.commit()
                
            yield "event: done\ndata: {\"success\": true}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps(f'AI Chat failed: {str(e)}')}\n\n"
        
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.post("/errors/explain")
async def explain_error():
    return {"explanation": "This feature is coming soon in the Python backend.", "corrected_query": "SELECT * FROM dual;"}

@router.post("/queries/estimate")
async def estimate_query():
    return {"cost": 0, "rows": 0, "risk_level": "LOW", "message": "Estimation coming soon in V2."}

@router.post("/indexes/estimate")
async def estimate_index():
    return {"status": "Not implemented"}

@router.get("/monitor/slow-queries")
async def slow_queries():
    return []

@router.get("/intelligence/history")
async def intelligence_history(user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    recent = db.query(QueryHistory).filter(QueryHistory.user_id == user_id).order_by(desc(QueryHistory.created_at)).limit(50).all()
    return [{"id": q.id, "original_query": q.original_query, "optimized_query": q.optimized_query, "created_at": q.created_at.isoformat()} for q in recent]

@router.get("/history")
async def get_history(user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    recent = db.query(QueryHistory).filter(QueryHistory.user_id == user_id).order_by(desc(QueryHistory.created_at)).all()
    return [{"id": q.id, "original_query": q.original_query, "optimized_query": q.optimized_query, "explanation": q.explanation, "bottlenecks": q.bottlenecks, "suggested_indexes": q.suggested_indexes, "created_at": q.created_at.isoformat()} for q in recent]

@router.get("/history/{id}")
async def get_history_entry(id: int, user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(QueryHistory).filter(QueryHistory.id == id, QueryHistory.user_id == user_id).first()
    if not q:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    return {"id": q.id, "original_query": q.original_query, "optimized_query": q.optimized_query, "explanation": q.explanation, "bottlenecks": q.bottlenecks, "suggested_indexes": q.suggested_indexes, "execution_plan_summary": q.execution_plan_summary, "query_complexity_score": q.query_complexity_score, "created_at": q.created_at.isoformat()}

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

class MigrateBody(BaseModel):
    query: str
    source_db: str
    target_db: str

@router.post("/migrate")
async def run_migration(request: MigrateBody, user_id: str = Depends(get_current_user)):
    from llm import llm
    from langchain_core.messages import HumanMessage, SystemMessage
    import asyncio
    try:
        prompt = f"""You are an expert database administrator and SQL developer.
Translate the following SQL query from {request.source_db} to {request.target_db}.
Provide the translated SQL query in a markdown code block, and a brief explanation.
Original Query:
```sql
{request.query}
```
"""
        messages = [
            SystemMessage(content="You are a SQL migration assistant. Always output the migrated SQL in a ```sql block and provide a concise explanation."),
            HumanMessage(content=prompt)
        ]
        # Use run_in_executor to avoid hanging if ainvoke gets stuck
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: llm.invoke(messages))
        
        content = response.content
        migrated_query = ""
        explanation = content
        
        match = re.search(r'```(?:sql)?\s*([\s\S]*?)\s*```', content, re.IGNORECASE)
        if match:
            migrated_query = match.group(1).strip()
            explanation = content.replace(match.group(0), "").strip()
            
        return {
            "original_query": request.query,
            "migrated_query": migrated_query,
            "explanation": explanation
        }
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=str(e))

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
        "created_at": history.created_at.isoformat()
    }
