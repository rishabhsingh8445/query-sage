import os
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from langchain_nvidia_ai_endpoints import NVIDIAEmbeddings
import uuid
from dotenv import load_dotenv

load_dotenv()

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")

try:
    if QDRANT_API_KEY:
        qdrant = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
    else:
        qdrant = QdrantClient(url=QDRANT_URL)
except Exception as e:
    print(f"Warning: Failed to connect to Qdrant: {e}")
    qdrant = None

embeddings = NVIDIAEmbeddings(
    model="NV-Embed-QA", # standard model for NVIDIA endpoints
    api_key=os.getenv("NVIDIA_API_KEY")
)

COLLECTION_NAME = "querysage_schema_v1"

def init_qdrant():
    if not qdrant:
        return
    try:
        collections = qdrant.get_collections().collections
        if not any(c.name == COLLECTION_NAME for c in collections):
            qdrant.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
            )
    except Exception as e:
        print(f"Failed to initialize Qdrant collection: {e}")

init_qdrant()

async def store_schema_chunk(workspace_id: str, table_name: str, schema_ddl: str):
    if not qdrant:
        return
    try:
        content = f"Table: {table_name}\nSchema:\n{schema_ddl}"
        vector = embeddings.embed_query(content)
        
        point_id = str(uuid.uuid4())
        qdrant.upsert(
            collection_name=COLLECTION_NAME,
            points=[
                PointStruct(
                    id=point_id,
                    vector=vector,
                    payload={
                        "workspace_id": workspace_id,
                        "table_name": table_name,
                        "schema_ddl": schema_ddl,
                        "content": content
                    }
                )
            ]
        )
    except Exception as e:
        print(f"Error storing schema chunk: {e}")

async def search_relevant_schema(workspace_id: str, query: str, limit: int = 5):
    if not qdrant:
        return []
    try:
        vector = embeddings.embed_query(query)
        results = qdrant.search(
            collection_name=COLLECTION_NAME,
            query_vector=vector,
            query_filter={
                "must": [
                    {
                        "key": "workspace_id",
                        "match": {"value": workspace_id}
                    }
                ]
            },
            limit=limit,
        )
        
        return [
            {
                "id": hit.id,
                "score": hit.score,
                "payload": hit.payload
            } for hit in results
        ]
    except Exception as e:
        print(f"Error searching schema: {e}")
        return []
