import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, queryHistoryTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import OpenAI from "openai";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const openaiClient = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

router.get("/intelligence/history", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const filterCondition = auth.orgId 
      ? eq(queryHistoryTable.orgId, auth.orgId)
      : eq(queryHistoryTable.userId, auth.userId);

    // Fetch last 30 queries
    const queries = await db
      .select({
        query: queryHistoryTable.originalQuery,
        bottlenecks: queryHistoryTable.bottlenecks,
        dbType: queryHistoryTable.dbType,
      })
      .from(queryHistoryTable)
      .where(filterCondition)
      .orderBy(desc(queryHistoryTable.createdAt))
      .limit(30);

    if (queries.length === 0) {
      res.json({
        common_bottlenecks: [],
        suggested_indexes: [],
        overall_health_score: 100,
        summary: "No query history available to analyze.",
      });
      return;
    }

    // Structure data for AI
    const analysisPayload = queries.map((q: any, i: number) => `Query ${i + 1} (${q.dbType}):\n${q.query}\nBottlenecks detected previously: ${JSON.stringify(q.bottlenecks)}\n`).join("\n---\n");

    const systemPrompt = `You are an expert Database Administrator analyzing a batch of recent queries (up to 30) for a specific application.
Look for overarching patterns, common missing indexes that would benefit multiple queries, and recurring bottlenecks (e.g., N+1 queries, full table scans on the same table).
Return a JSON object containing:
- common_bottlenecks: array of strings describing the high-level issues
- suggested_indexes: array of objects { table, column, reason, impact }
- overall_health_score: integer from 0 to 100
- summary: a short paragraph summarizing the health of these queries`;

    const completion = await openaiClient.chat.completions.create({
      model: "meta/llama-3.1-70b-instruct",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Please analyze the following recent query history and provide insights in JSON format:\n\n${analysisPayload}` }
      ],
      temperature: 0.2,
    });

    const aiResponse = completion.choices[0]?.message?.content;
    if (!aiResponse) {
      throw new Error("Empty response from AI");
    }

    let clean = aiResponse.trim();
    if (clean.startsWith("```")) {
      const parts = clean.split("```");
      clean = parts[1] ?? "";
      if (clean.startsWith("json")) {
        clean = clean.slice(4);
      }
    }
    clean = clean.trim();

    const parsedResponse = JSON.parse(clean);
    res.json(parsedResponse);
  } catch (err: any) {
    logger.error({ err }, "Failed to generate query history intelligence");
    res.status(500).json({ error: "Failed to analyze query history" });
  }
});

export { router as intelligenceRouter };
