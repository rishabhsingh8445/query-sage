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
  chat_history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string()
  })).optional().default([]),
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
    const relevantSchema = await searchRelevantSchema(auth.userId, message, 3);
    
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
      .select({ originalQuery: queryHistoryTable.originalQuery })
      .from(queryHistoryTable)
      .where(eq(queryHistoryTable.userId, auth.userId))
      .orderBy(desc(queryHistoryTable.createdAt))
      .limit(5);

    let queryHistoryContext = "";
    if (recentQueries.length > 0) {
      queryHistoryContext = "Recent User Queries Context:\n";
      recentQueries.forEach((q, i) => {
        queryHistoryContext += `[Query ${i+1}]: ${q.originalQuery}\n`;
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

    const currentChat = [...chat_history];
    currentChat.push({ role: "user", content: message });

    const fullResponse = await streamChatResponse({
      chatHistory: currentChat,
      context: fullContext,
      onChunk: (chunk) => {
        sendEvent("chunk", chunk);
      }
    });

    sendEvent("done", { success: true });
    res.end();
  } catch (err: any) {
    req.log.error({ err }, "Failed to stream schema chat");
    res.status(500).json({ error: "Failed to process schema chat" });
  }
});

export { router as chatRouter };
