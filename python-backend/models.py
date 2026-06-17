from sqlalchemy import Column, Integer, String, Text, JSON, DateTime, func
from database import Base
import uuid

class QueryHistory(Base):
    __tablename__ = "query_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, nullable=False)
    org_id = Column(String, nullable=True)
    original_query = Column(Text, nullable=False)
    optimized_query = Column(Text, nullable=False)
    explanation = Column(Text, nullable=False)
    bottlenecks = Column(JSON, nullable=False)
    suggested_indexes = Column(JSON, nullable=False)
    estimated_improvement = Column(Text, nullable=False)
    execution_plan_summary = Column(Text, nullable=False)
    db_type = Column(String, nullable=False)
    query_complexity_score = Column(Integer, nullable=True)
    share_id = Column(String, unique=True, nullable=True)
    chat_history = Column(JSON, nullable=False, default=[])
    created_at = Column(DateTime, default=func.now(), nullable=False)

class SchemaChatThread(Base):
    __tablename__ = "schema_chat_threads"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False)
    title = Column(String, nullable=False)
    messages = Column(JSON, nullable=False, default=[])
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
