import os
import uuid
import re
import requests
import json
from dotenv import load_dotenv
from llm import get_groq_llm
from langchain_core.messages import SystemMessage, HumanMessage

load_dotenv()

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333").rstrip('/')
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")

COLLECTION_NAME = "querysage_schema_v2"
HISTORY_COLLECTION = "querysage_history_v2"
PLAYBOOK_COLLECTION = "querysage_playbook_v2"

# 768-dimensional dummy vector to satisfy Qdrant's vector schema without external embedding API
DUMMY_VECTOR = [0.0] * 768

def qdrant_headers():
    headers = {"Content-Type": "application/json"}
    if QDRANT_API_KEY:
        headers["api-key"] = QDRANT_API_KEY
    return headers


def init_qdrant():
    """Initializes the Qdrant collections if they do not exist."""
    try:
        resp = requests.get(f"{QDRANT_URL}/collections", headers=qdrant_headers())
        if resp.status_code == 200:
            collections = resp.json().get("result", {}).get("collections", [])
            existing_names = [c.get("name") for c in collections]
                
            for name in [COLLECTION_NAME, HISTORY_COLLECTION, PLAYBOOK_COLLECTION]:
                if name not in existing_names:
                    payload = {
                        "vectors": {
                            "size": 768,
                            "distance": "Cosine"
                        }
                    }
                    requests.put(f"{QDRANT_URL}/collections/{name}", headers=qdrant_headers(), json=payload)
            
            seed_playbook_data()
    except Exception as e:
        print(f"Failed to initialize Qdrant collections: {e}")


def seed_playbook_data():
    """Seeds the playbook collection in Qdrant with SQL best practices using dummy vectors."""
    try:
        resp = requests.post(f"{QDRANT_URL}/collections/{PLAYBOOK_COLLECTION}/points/scroll", headers=qdrant_headers(), json={"limit": 1})
        if resp.status_code == 200 and len(resp.json().get("result", {}).get("points", [])) > 0:
            return
            
        playbook_path = os.path.join(os.path.dirname(__file__), "sql_best_practices.md")
        if not os.path.exists(playbook_path):
            return
            
        with open(playbook_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        sections = content.split("## ")
        for sec in sections[1:]:
            lines = sec.split("\n")
            if not lines:
                continue
            header = lines[0].strip()
            body = "\n".join(lines[1:]).strip()
            
            dialect = "Global"
            title = header
            match = re.search(r'\[(.*?)\]\s*(.*)', header)
            if match:
                dialect = match.group(1).strip()
                title = match.group(2).strip()
                
            if title and body:
                chunk_text = f"Dialect: {dialect}\nCategory: {title}\nRule: {body}"
                point_id = str(uuid.uuid4())
                payload = {
                    "points": [
                        {
                            "id": point_id,
                            "vector": DUMMY_VECTOR,
                            "payload": {
                                "title": title,
                                "rule": body,
                                "dialect": dialect,
                                "content": chunk_text
                            }
                        }
                    ]
                }
                requests.put(f"{QDRANT_URL}/collections/{PLAYBOOK_COLLECTION}/points", headers=qdrant_headers(), json=payload)
        print("Successfully seeded Qdrant Playbook with SQL Best Practices!")
    except Exception as e:
        print(f"Failed to seed playbook data in Qdrant: {e}")


init_qdrant()


async def store_schema_chunk(workspace_id: str, table_name: str, schema_ddl: str):
    """Stores schema tables in Qdrant database using dummy vectors."""
    try:
        content = f"Table: {table_name}\nSchema:\n{schema_ddl}"
        point_id = str(uuid.uuid4())
        payload = {
            "points": [
                {
                    "id": point_id,
                    "vector": DUMMY_VECTOR,
                    "payload": {
                        "workspace_id": workspace_id,
                        "table_name": table_name,
                        "schema_ddl": schema_ddl,
                        "content": content
                    }
                }
            ]
        }
        resp = requests.put(f"{QDRANT_URL}/collections/{COLLECTION_NAME}/points", headers=qdrant_headers(), json=payload)
        resp.raise_for_status()
    except Exception as e:
        print(f"Error storing schema chunk in Qdrant: {e}")


async def search_relevant_schema(workspace_id: str, query: str, limit: int = 5):
    """
    Retrieves all table schemas for the workspace from Qdrant,
    then filters them to return only tables referenced in the query.
    """
    try:
        # Scroll schemas from Qdrant matching workspace_id
        scroll_payload = {
            "filter": {
                "must": [
                    {
                        "key": "workspace_id",
                        "match": {"value": workspace_id}
                    }
                ]
            },
            "limit": 100
        }
        resp = requests.post(f"{QDRANT_URL}/collections/{COLLECTION_NAME}/points/scroll", headers=qdrant_headers(), json=scroll_payload)
        if resp.status_code != 200:
            return []

        points = resp.json().get("result", {}).get("points", [])
        query_words = set(re.findall(r'\b\w+\b', query.lower()))
        matched_hits = []

        for p in points:
            payload = p.get("payload", {})
            table_name = payload.get("table_name", "")
            
            # Check if table is referenced in SQL query
            if table_name and table_name.lower() in query_words:
                matched_hits.append({
                    "id": p.get("id"),
                    "score": 1.0,
                    "payload": payload
                })
                if len(matched_hits) >= limit:
                    break

        return matched_hits
    except Exception as e:
        print(f"Error searching schema in Qdrant: {e}")
        return []


async def store_query_history_chunk(user_id: str, original_query: str, optimized_query: str, explanation: str):
    """Stores query history in Qdrant using dummy vectors."""
    try:
        content = f"Original Query:\n{original_query}\n\nOptimized Query:\n{optimized_query}\n\nExplanation:\n{explanation}"
        point_id = str(uuid.uuid4())
        payload = {
            "points": [
                {
                    "id": point_id,
                    "vector": DUMMY_VECTOR,
                    "payload": {
                        "user_id": user_id,
                        "original_query": original_query,
                        "optimized_query": optimized_query,
                        "explanation": explanation,
                        "content": content
                    }
                }
            ]
        }
        resp = requests.put(f"{QDRANT_URL}/collections/{HISTORY_COLLECTION}/points", headers=qdrant_headers(), json=payload)
        resp.raise_for_status()
    except Exception as e:
        print(f"Error storing query history chunk in Qdrant: {e}")


async def search_query_history(user_id: str, query: str, limit: int = 1):
    """
    Retrieves user history from Qdrant and uses the Groq LLM to semantically
    select the most similar query profile.
    """
    try:
        # Scroll past query points from Qdrant
        scroll_payload = {
            "filter": {
                "must": [
                    {
                        "key": "user_id",
                        "match": {"value": user_id}
                    }
                ]
            },
            "limit": 15
        }
        resp = requests.post(f"{QDRANT_URL}/collections/{HISTORY_COLLECTION}/points/scroll", headers=qdrant_headers(), json=scroll_payload)
        if resp.status_code != 200:
            return []

        points = resp.json().get("result", {}).get("points", [])
        if not points:
            return []

        # Prepare candidates for Groq evaluation
        candidates = []
        for p in points:
            payload = p.get("payload", {})
            candidates.append({
                "id": p.get("id"),
                "original_query": payload.get("original_query", "")
            })

        # Ask Groq to select the most structurally similar query
        llm = get_groq_llm(temperature=0.1)
        system_prompt = "You are a database query matcher. Given a new query and a list of past queries with IDs, identify the ID of the query that is most structurally similar. If none are structurally similar, return 'None'. Respond ONLY with the matched ID string or the word 'None'."
        user_prompt = f"New Query:\n{query}\n\nPast Queries:\n{json.dumps(candidates, indent=2)}"
        
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ])
        
        matched_id = response.content.strip().replace('"', '').replace("'", "")
        
        if matched_id and matched_id != "None":
            # Find the matched point
            for p in points:
                if p.get("id") == matched_id:
                    return [{
                        "id": p.get("id"),
                        "score": 0.95,
                        "payload": p.get("payload", {})
                    }]
                    
        return []
    except Exception as e:
        print(f"Error searching query history in Qdrant via Groq: {e}")
        return []


async def search_playbook(query: str, dialect: str = "Global", limit: int = 2):
    """
    Retrieves SQL playbook rules from Qdrant and uses the Groq LLM to semantically
    select the most applicable performance tuning guidelines.
    """
    try:
        dialect_val = "Global"
        if dialect:
            d_lower = dialect.lower()
            if "postgres" in d_lower:
                dialect_val = "PostgreSQL"
            elif "mysql" in d_lower:
                dialect_val = "MySQL"
            elif "sqlite" in d_lower:
                dialect_val = "SQLite"

        # Scroll playbook rules from Qdrant
        scroll_payload = {
            "limit": 100
        }
        resp = requests.post(f"{QDRANT_URL}/collections/{PLAYBOOK_COLLECTION}/points/scroll", headers=qdrant_headers(), json=scroll_payload)
        if resp.status_code != 200:
            return []

        points = resp.json().get("result", {}).get("points", [])
        
        # Filter rules by dialect compatibility
        candidates = []
        for p in points:
            payload = p.get("payload", {})
            rule_dialect = payload.get("dialect", "Global")
            if rule_dialect == "Global" or rule_dialect.lower() == dialect_val.lower():
                candidates.append({
                    "id": p.get("id"),
                    "title": payload.get("title", ""),
                    "rule": payload.get("rule", "")
                })

        if not candidates:
            return []

        # Ask Groq to select the top applicable rules
        llm = get_groq_llm(temperature=0.1)
        system_prompt = f"You are a database administrator. Given an SQL query, select up to {limit} rules from the provided candidates list that are directly applicable to optimizing this query. Return ONLY a JSON array of the matched rule IDs. If no rules apply, return []."
        user_prompt = f"SQL Query:\n{query}\n\nCandidate Rules:\n{json.dumps(candidates, indent=2)}"
        
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ])
        
        # Parse matched IDs
        clean = response.content.strip()
        match = re.search(r'\[([\s\S]*?)\]', clean)
        if match:
            clean = match.group(0)
            
        try:
            matched_ids = json.loads(clean)
        except Exception:
            matched_ids = []

        matched_hits = []
        for m_id in matched_ids:
            for p in points:
                if p.get("id") == m_id:
                    matched_hits.append({
                        "id": p.get("id"),
                        "score": 1.0,
                        "payload": p.get("payload", {})
                    })
                    
        return matched_hits[:limit]
    except Exception as e:
        print(f"Error searching playbook in Qdrant via Groq: {e}")
        return []
