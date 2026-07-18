import os
import uuid
import re
import requests
from dotenv import load_dotenv

load_dotenv()

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333").rstrip('/')
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

COLLECTION_NAME = "querysage_schema_v2"
HISTORY_COLLECTION = "querysage_history_v2"
PLAYBOOK_COLLECTION = "querysage_playbook_v2"

def qdrant_headers():
    headers = {"Content-Type": "application/json"}
    if QDRANT_API_KEY:
        headers["api-key"] = QDRANT_API_KEY
    return headers

def get_embedding(text: str) -> list:
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is not set")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key={GEMINI_API_KEY}"
    payload = {
        "model": "models/text-embedding-004",
        "content": {
            "parts": [{"text": text}]
        }
    }
    resp = requests.post(url, json=payload)
    resp.raise_for_status()
    data = resp.json()
    return data.get("embedding", {}).get("values", [])

def init_qdrant():
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
            title = lines[0].strip()
            body = "\n".join(lines[1:]).strip()
            if title and body:
                chunk_text = f"Category: {title}\nRule: {body}"
                vector = get_embedding(chunk_text)
                point_id = str(uuid.uuid4())
                payload = {
                    "points": [
                        {
                            "id": point_id,
                            "vector": vector,
                            "payload": {
                                "title": title,
                                "rule": body,
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
    try:
        content = f"Table: {table_name}\nSchema:\n{schema_ddl}"
        vector = get_embedding(content)
        
        point_id = str(uuid.uuid4())
        payload = {
            "points": [
                {
                    "id": point_id,
                    "vector": vector,
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
        print(f"Error storing schema chunk: {e}")

async def search_relevant_schema(workspace_id: str, query: str, limit: int = 5):
    try:
        vector = get_embedding(query)
        payload = {
            "vector": vector,
            "filter": {
                "must": [
                    {
                        "key": "workspace_id",
                        "match": {"value": workspace_id}
                    }
                ]
            },
            "limit": limit
        }
        resp = requests.post(f"{QDRANT_URL}/collections/{COLLECTION_NAME}/points/search", headers=qdrant_headers(), json=payload)
        if resp.status_code == 200:
            results = resp.json().get("result", [])
            return [
                {
                    "id": hit.get("id"),
                    "score": hit.get("score"),
                    "payload": hit.get("payload")
                } for hit in results
            ]
        return []
    except Exception as e:
        print(f"Error searching schema: {e}")
        return []

async def store_query_history_chunk(user_id: str, original_query: str, optimized_query: str, explanation: str):
    try:
        content = f"Original Query:\n{original_query}\n\nOptimized Query:\n{optimized_query}\n\nExplanation:\n{explanation}"
        vector = get_embedding(original_query)
        point_id = str(uuid.uuid4())
        payload = {
            "points": [
                {
                    "id": point_id,
                    "vector": vector,
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
        print(f"Error storing query history chunk: {e}")

async def search_query_history(user_id: str, query: str, limit: int = 1):
    try:
        vector = get_embedding(query)
        payload = {
            "vector": vector,
            "filter": {
                "must": [
                    {
                        "key": "user_id",
                        "match": {"value": user_id}
                    }
                ]
            },
            "limit": limit
        }
        resp = requests.post(f"{QDRANT_URL}/collections/{HISTORY_COLLECTION}/points/search", headers=qdrant_headers(), json=payload)
        if resp.status_code == 200:
            results = resp.json().get("result", [])
            return [
                {
                    "id": hit.get("id"),
                    "score": hit.get("score"),
                    "payload": hit.get("payload")
                } for hit in results
            ]
        return []
    except Exception as e:
        print(f"Error searching query history: {e}")
        return []

async def search_playbook(query: str, limit: int = 2):
    try:
        vector = get_embedding(query)
        payload = {
            "vector": vector,
            "limit": limit
        }
        resp = requests.post(f"{QDRANT_URL}/collections/{PLAYBOOK_COLLECTION}/points/search", headers=qdrant_headers(), json=payload)
        if resp.status_code == 200:
            results = resp.json().get("result", [])
            return [
                {
                    "id": hit.get("id"),
                    "score": hit.get("score"),
                    "payload": hit.get("payload")
                } for hit in results
            ]
        return []
    except Exception as e:
        print(f"Error searching playbook: {e}")
        return []
