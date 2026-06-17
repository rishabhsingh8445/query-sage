import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, queryHistoryTable } from "@workspace/db";
import { ChatWithAIBody } from "@workspace/api-zod";
import { streamChatResponse } from "../lib/llmService";
import { searchRelevantSchema } from "../lib/ragService";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

// Existing chat endpoint for specific history
router.post("/chat", async (req, res): Promise<void> => {
  const parsed = ChatWithAIBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { history_id, message } = parsed.data;
  
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [history] = await db
      .select()
      .from(queryHistoryTable)
      .where(and(eq(queryHistoryTable.id, history_id), eq(queryHistoryTable.userId, auth.userId)));

    if (!history) {
      res.status(404).json({ error: "History not found" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendEvent = (type: string, data: any) => {
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    };

    const context = `
Original Query:
${history.originalQuery}

Optimized Query:
${history.optimizedQuery}

Explanation:
${history.explanation}
    `.trim();

    const currentChat = [...(history.chatHistory || [])];
    currentChat.push({ role: "user", content: message });

    const fullResponse = await streamChatResponse({
      chatHistory: currentChat,
      context,
      onChunk: (chunk) => {
        sendEvent("chunk", chunk);
      }
    });

    currentChat.push({ role: "assistant", content: fullResponse });

    await db
      .update(queryHistoryTable)
      .set({ chatHistory: currentChat })
      .where(eq(queryHistoryTable.id, history_id));

    sendEvent("done", { success: true });
    res.end();
  } catch (err: any) {
    req.log.error({ err }, "Failed to stream chat");
    res.status(500).json({ error: "Failed to process chat" });
  }
});

const SchemaChatBody = z.object({
  message: z.string(),
  thread_id: z.string().optional(),
  chat_history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string()
  })).optional().default([]),
});

import { schemaChatThreadsTable } from "@workspace/db";

// Get all schema chat threads for the user
router.get("/schema-chat/threads", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const threads = await db
      .select({ id: schemaChatThreadsTable.id, title: schemaChatThreadsTable.title, createdAt: schemaChatThreadsTable.createdAt })
      .from(schemaChatThreadsTable)
      .where(eq(schemaChatThreadsTable.userId, auth.userId))
      .orderBy(desc(schemaChatThreadsTable.createdAt));
    
    res.json(threads);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch schema chat threads");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get a specific thread
router.get("/schema-chat/threads/:id", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [thread] = await db
      .select()
      .from(schemaChatThreadsTable)
      .where(and(eq(schemaChatThreadsTable.id, req.params.id), eq(schemaChatThreadsTable.userId, auth.userId)));
    
    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    res.json(thread);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch schema chat thread");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete a thread
router.delete("/schema-chat/threads/:id", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await db
      .delete(schemaChatThreadsTable)
      .where(and(eq(schemaChatThreadsTable.id, req.params.id), eq(schemaChatThreadsTable.userId, auth.userId)));
    
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete schema chat thread");
    res.status(500).json({ error: "Internal server error" });
  }
});

// New Schema-Aware RAG Chat Endpoint
router.post("/schema-chat", async (req, res): Promise<void> => {
  const parsed = SchemaChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { message, chat_history } = parsed.data;
  
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    // 1. Fetch relevant schema chunks from Qdrant
    // Note: Using auth.userId as workspace_id for now until Team Workspaces are fully implemented
    let relevantSchema: any[] = [];
    try {
      relevantSchema = await searchRelevantSchema(auth.userId, message, 3);
    } catch (err) {
      req.log.warn({ err }, "Qdrant search failed, falling back to empty schema");
    }
    let schemaContext = "";
    if (relevantSchema.length > 0) {
      schemaContext = "Relevant Database Schema Context:\n";
      for (const result of relevantSchema) {
        if (result.payload && result.payload.schema_ddl) {
          schemaContext += `-- Table: ${result.payload.table_name}\n`;
          schemaContext += `${result.payload.schema_ddl}\n\n`;
        }
      }
    } else {
      schemaContext = "No specific schema definitions found in vector store.";
    }

    // 2. Fetch recent query history for context
    const recentQueries = await db
      .select({ 
        originalQuery: queryHistoryTable.originalQuery,
        optimizedQuery: queryHistoryTable.optimizedQuery,
        createdAt: queryHistoryTable.createdAt
      })
      .from(queryHistoryTable)
      .where(eq(queryHistoryTable.userId, auth.userId))
      .orderBy(desc(queryHistoryTable.createdAt))
      .limit(50);

    let queryHistoryContext = "";
    if (recentQueries.length > 0) {
      queryHistoryContext = "Recent User Queries Context (Up to 50 latest):\n";
      recentQueries.forEach((q: any, i: number) => {
        const dateStr = q.createdAt ? new Date(q.createdAt).toLocaleString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit' 
        }) : 'Unknown Date';
        queryHistoryContext += `[Query ${i+1} Original]: ${q.originalQuery}\n[Query ${i+1} Optimized]: ${q.optimizedQuery}\n[Query ${i+1} Date]: ${dateStr}\n\n`;
      });
    }

    // Combine context
    const fullContext = `
${schemaContext}
---
${queryHistoryContext}
    `.trim();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendEvent = (type: string, data: any) => {
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    };

    let threadId = parsed.data.thread_id;
    let currentChat = [...chat_history];
    currentChat.push({ role: "user", content: message });

    if (!threadId) {
      const [newThread] = await db.insert(schemaChatThreadsTable).values({
        userId: auth.userId,
        title: message.substring(0, 50) + (message.length > 50 ? "..." : ""),
        messages: currentChat,
      }).returning();
      threadId = newThread.id;
    } else {
      // Just to ensure it exists
      const [existingThread] = await db.select().from(schemaChatThreadsTable).where(and(eq(schemaChatThreadsTable.id, threadId), eq(schemaChatThreadsTable.userId, auth.userId)));
      if (!existingThread) {
        throw new Error("Thread not found");
      }
    }

    sendEvent("thread_id", { thread_id: threadId });

    const fullResponse = await streamChatResponse({
      chatHistory: currentChat,
      context: fullContext,
      onChunk: (chunk) => {
        sendEvent("chunk", chunk);
      }
    });

    currentChat.push({ role: "assistant", content: fullResponse });

    await db.update(schemaChatThreadsTable)
      .set({ messages: currentChat, updatedAt: new Date() })
      .where(and(eq(schemaChatThreadsTable.id, threadId!), eq(schemaChatThreadsTable.userId, auth.userId)));

    sendEvent("done", { success: true });
    res.end();
  } catch (err: any) {
    req.log.error({ err }, "Failed to stream schema chat");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to process schema chat" });
    } else {
      res.write(`event: chunk\ndata: ${JSON.stringify("\n\n**Error:** I'm sorry, but I encountered an error while processing your request. Please try again.")}\n\n`);
      res.write(`event: done\ndata: {"success":false}\n\n`);
      res.end();
    }
  }
});

export { router as chatRouter };
