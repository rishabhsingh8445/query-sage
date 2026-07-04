import os
import uuid
import requests
from dotenv import load_dotenv

load_dotenv()

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333").rstrip('/')
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
HF_TOKEN = os.getenv("HF_TOKEN")

COLLECTION_NAME = "querysage_schema_v2"

def qdrant_headers():
    headers = {"Content-Type": "application/json"}
    if QDRANT_API_KEY:
        headers["api-key"] = QDRANT_API_KEY
    return headers

def get_embedding(text: str) -> list:
    if not HF_TOKEN:
        raise ValueError("HF_TOKEN is not set in environment variables")
    
    url = "https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2"
    headers = {"Authorization": f"Bearer {HF_TOKEN}"}
    payload = {"inputs": [text]}
    
    resp = requests.post(url, headers=headers, json=payload)
    resp.raise_for_status()
    
    # HF API returns a list of lists for feature-extraction pipeline
    data = resp.json()
    if isinstance(data, list) and len(data) > 0:
        return data[0]
    return []

def init_qdrant():
    try:
        resp = requests.get(f"{QDRANT_URL}/collections", headers=qdrant_headers())
        if resp.status_code == 200:
            collections = resp.json().get("result", {}).get("collections", [])
            if not any(c.get("name") == COLLECTION_NAME for c in collections):
                payload = {
                    "vectors": {
                        "size": 768,
                        "distance": "Cosine"
                    }
                }
                requests.put(f"{QDRANT_URL}/collections/{COLLECTION_NAME}", headers=qdrant_headers(), json=payload)
    except Exception as e:
        print(f"Failed to initialize Qdrant collection: {e}")

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
