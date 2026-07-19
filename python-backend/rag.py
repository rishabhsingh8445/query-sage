import os
import re
from typing import List, Dict
from database import SessionLocal
from models import SchemaHistory, QueryHistory

# Read and parse playbook rules from sql_best_practices.md once at import time
PLAYBOOK_RULES = []
try:
    playbook_path = os.path.join(os.path.dirname(__file__), "sql_best_practices.md")
    if os.path.exists(playbook_path):
        with open(playbook_path, "r", encoding="utf-8") as f:
            content = f.read()
        sections = content.split("## ")
        for sec in sections[1:]:
            lines = sec.split("\n")
            if not lines:
                continue
            header = lines[0].strip()
            body = "\n".join(lines[1:]).strip()
            
            dialect_val = "Global"
            title = header
            match = re.search(r'\[(.*?)\]\s*(.*)', header)
            if match:
                dialect_val = match.group(1).strip()
                title = match.group(2).strip()
            
            if title and body:
                PLAYBOOK_RULES.append({
                    "title": title,
                    "rule": body,
                    "dialect": dialect_val
                })
        print(f"Loaded {len(PLAYBOOK_RULES)} SQL Best Practices rules locally!")
except Exception as e:
    print(f"Failed to load local playbook rules: {e}")


def get_jaccard_similarity(q1: str, q2: str) -> float:
    """Computes keyword overlap (Jaccard similarity) between two SQL queries."""
    w1 = set(re.findall(r'\b\w+\b', q1.lower()))
    w2 = set(re.findall(r'\b\w+\b', q2.lower()))
    if not w1 or not w2:
        return 0.0
    return len(w1.intersection(w2)) / len(w1.union(w2))


async def store_schema_chunk(workspace_id: str, table_name: str, schema_ddl: str):
    """Noop: Schema history is already saved in the SQL database."""
    pass


async def search_relevant_schema(workspace_id: str, query: str, limit: int = 5):
    """
    Fetches the user's latest DDL schema from database, parses the tables, 
    and returns schemas for tables that are explicitly mentioned in the query.
    """
    try:
        db = SessionLocal()
        latest_schema = db.query(SchemaHistory).filter(SchemaHistory.user_id == workspace_id).order_by(SchemaHistory.created_at.desc()).first()
        db.close()

        if not latest_schema or not latest_schema.ddl:
            return []

        clean_ddl = re.sub(r'/\*.*?\*/', '', latest_schema.ddl)
        clean_ddl = re.sub(r'--.*$', '', clean_ddl, flags=re.M)

        # Parse tables from DDL
        table_regex = re.compile(
            r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w`"\[\]]+\.)?([a-zA-Z0-9_`"\[\]]+)\s*\((.*?)\)(?:;|\s*$|\Z)',
            re.IGNORECASE | re.DOTALL
        )
        
        query_words = set(re.findall(r'\b\w+\b', query.lower()))
        matched_hits = []

        for match in table_regex.finditer(clean_ddl):
            table_name = match.group(1).replace('`','').replace('"','').replace('[','').replace(']','').strip()
            table_ddl = match.group(0).strip()
            
            # If the query references the table name, return its DDL definition
            if table_name.lower() in query_words:
                matched_hits.append({
                    "id": table_name,
                    "score": 1.0,
                    "payload": {
                        "table_name": table_name,
                        "schema_ddl": table_ddl
                    }
                })
                if len(matched_hits) >= limit:
                    break

        return matched_hits
    except Exception as e:
        print(f"Local schema search failed: {e}")
        return []


async def store_query_history_chunk(user_id: str, original_query: str, optimized_query: str, explanation: str):
    """Noop: Query history is already saved in the SQL database."""
    pass


async def search_query_history(user_id: str, query: str, limit: int = 1):
    """
    Fetches past user optimizations from SQL database and matches them 
    using keyword similarity to detect similar query structures.
    """
    try:
        db = SessionLocal()
        past_queries = db.query(QueryHistory).filter(QueryHistory.user_id == user_id).order_by(QueryHistory.created_at.desc()).limit(20).all()
        db.close()

        if not past_queries:
            return []

        scored_matches = []
        for q in past_queries:
            similarity = get_jaccard_similarity(query, q.original_query)
            # High similarity matches only (> 0.70 threshold)
            if similarity >= 0.70:
                scored_matches.append({
                    "id": str(q.id),
                    "score": similarity,
                    "payload": {
                        "original_query": q.original_query,
                        "optimized_query": q.optimized_query,
                        "explanation": q.explanation
                    }
                })

        # Sort by similarity score descending
        scored_matches.sort(key=lambda x: x["score"], reverse=True)
        return scored_matches[:limit]
    except Exception as e:
        print(f"Local query history search failed: {e}")
        return []


async def search_playbook(query: str, dialect: str = "Global", limit: int = 2):
    """
    Finds matching SQL best practices from the playbook using keyword intersection.
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

        query_words = set(re.findall(r'\b\w+\b', query.lower()))
        scored_rules = []

        for r in PLAYBOOK_RULES:
            # Only match Global rules or specific dialect rules
            if r["dialect"] == "Global" or r["dialect"].lower() == dialect_val.lower():
                # Score based on keyword intersection with the rule content
                rule_words = set(re.findall(r'\b\w+\b', (r["title"] + " " + r["rule"]).lower()))
                matches = query_words.intersection(rule_words)
                
                # Check for critical query patterns (e.g. JOIN, subqueries, OR)
                extra_score = 0
                if "join" in r["title"].lower() and "join" in query_words:
                    extra_score += 5
                if "subquery" in r["title"].lower() and ("select" in query_words or "in" in query_words):
                    extra_score += 3
                if "index" in r["title"].lower() and ("where" in query_words or "join" in query_words):
                    extra_score += 2

                score = len(matches) + extra_score
                if score > 0:
                    scored_rules.append({
                        "score": score,
                        "rule": r
                    })

        # Sort by match score descending
        scored_rules.sort(key=lambda x: x["score"], reverse=True)
        
        return [
            {
                "id": f"playbook_{i}",
                "score": float(item["score"]),
                "payload": {
                    "title": item["rule"]["title"],
                    "rule": item["rule"]["rule"],
                    "dialect": item["rule"]["dialect"]
                }
            } for i, item in enumerate(scored_rules[:limit])
        ]
    except Exception as e:
        print(f"Local playbook search failed: {e}")
        return []
