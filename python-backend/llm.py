import os
from langchain_groq import ChatGroq
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

def get_groq_llm(temperature=0.2):
    return ChatGroq(
        model="llama-3.3-70b-versatile",
        api_key=os.getenv("GROQ_API_KEY", "dummy-key"),
        temperature=temperature
    )

def get_gemini_llm(temperature=0.2):
    return ChatGoogleGenerativeAI(
        model="gemini-1.5-flash",
        api_key=os.getenv("GEMINI_API_KEY", "dummy-key"),
        temperature=temperature
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
    llm = get_gemini_llm()
    async for chunk in llm.astream(messages):
        if chunk.content:
            await on_chunk(chunk.content)
            full_response += chunk.content
            
    return full_response
