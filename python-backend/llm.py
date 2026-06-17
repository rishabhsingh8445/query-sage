import os
from langchain_nvidia_ai_endpoints import ChatNVIDIA
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

llm = ChatNVIDIA(
    model="meta/llama-3.3-70b-instruct",
    api_key=os.getenv("NVIDIA_API_KEY", "dummy-key-to-bypass-init"),
    temperature=0.2
)

async def stream_chat_response(chat_history: list, context: str, on_chunk):
    """
    Streams a chat response back to the user based on history and context.
    """
    system_prompt = f"""You are QuerySage, an expert database architect and performance tuning assistant.
Use the following context to answer the user's questions.

Guidelines for answering:
- If the user asks about their recent queries, be concise and summarize intelligently rather than blindly repeating "Query 1", "Query 2", etc.
- If asked about dates or times, read the timestamp carefully and provide a clear, natural-sounding answer (e.g., "Your latest query was optimized today at 2:30 PM").
- Do not get confused by multiple queries having the same date. Just summarize the activity.

{context}
"""
    messages = [SystemMessage(content=system_prompt)]
    
    for msg in chat_history:
        if msg.get("role") == "user":
            messages.append(HumanMessage(content=msg.get("content")))
        else:
            messages.append(AIMessage(content=msg.get("content")))
            
    full_response = ""
    async for chunk in llm.astream(messages):
        if chunk.content:
            await on_chunk(chunk.content)
            full_response += chunk.content
            
    return full_response
