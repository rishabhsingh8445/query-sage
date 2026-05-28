import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, queryHistoryTable } from "@workspace/db";
import { AnalyzeQueryBody, AnalyzeQueryResponse } from "@workspace/api-zod";
import { optimizeQuery, streamOptimizeQuery } from "../lib/llmService";
import { parseExplainOutput } from "../lib/explainParser";
import pg from "pg";
import rateLimit from "express-rate-limit";

// Limit to 10 requests per minute per IP
const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many requests from this IP, please try again after a minute." },
  standardHeaders: true,
  legacyHeaders: false,
});

const router: IRouter = Router();

router.post("/analyze", analyzeLimiter, async (req, res): Promise<void> => {
  const parsed = AnalyzeQueryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { query, db_type, manual_schema, explain_output, db_config } = parsed.data;

  let schema = manual_schema ?? "";
  let explainOutput = explain_output ?? "";

  // If Live Database mode is used, fetch the actual explain output
  if (db_config && db_config.db_type === "postgresql") {
    try {
      const client = new pg.Client({
        host: db_config.host,
        port: db_config.port,
        database: db_config.database,
        user: db_config.username,
        password: db_config.password,
        ssl: { rejectUnauthorized: false }
      });
      await client.connect();
      
      // Attempt to get a basic schema definition
      const schemaRes = await client.query(`
        SELECT table_name, column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public';
      `);
      schema = "Tables and Columns:\n" + JSON.stringify(schemaRes.rows, null, 2);

      // Run EXPLAIN ANALYZE
      const explainRes = await client.query(`EXPLAIN ANALYZE ${query}`);
      explainOutput = explainRes.rows.map((r: any) => r['QUERY PLAN']).join('\n');
      
      await client.end();
    } catch (err: any) {
      req.log.error({ err }, "Live DB connection failed");
      res.status(400).json({ error: "Failed to run query on Live Database: " + err.message });
      return;
    }
  } else if (db_config && db_config.db_type === "mysql") {
    try {
      const mysql = await import("mysql2/promise");
      const connection = await mysql.createConnection({
        host: db_config.host,
        port: db_config.port,
        user: db_config.username,
        password: db_config.password,
        database: db_config.database,
      });

      const [schemaRes] = await connection.query(`
        SELECT table_name, column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = ?;
      `, [db_config.database]);
      schema = "Tables and Columns:\n" + JSON.stringify(schemaRes, null, 2);

      const [explainRes]: any = await connection.query(`EXPLAIN ANALYZE ${query}`);
      explainOutput = explainRes.map((r: any) => Object.values(r)[0]).join('\n');

      await connection.end();
    } catch (err: any) {
      req.log.error({ err }, "Live MySQL connection failed");
      res.status(400).json({ error: "Failed to run query on Live MySQL Database: " + err.message });
      return;
    }
  }

  const explainResult = parseExplainOutput(explainOutput, db_type);

  let llmResult;
  try {
    llmResult = await optimizeQuery({
      query,
      schema,
      explainOutput,
      bottlenecks: explainResult.bottlenecks,
      dbType: db_type,
    });
  } catch (err) {
    req.log.error({ err }, "LLM optimization failed");
    res.status(500).json({ error: "Failed to optimize query. Please check your NVIDIA API key and try again." });
    return;
  }

  const auth = getAuth(req);
  const userId = auth?.userId;
  const orgId = auth?.orgId;

  let savedId: number | null = null;
  if (userId) {
    try {
      const [saved] = await db.insert(queryHistoryTable).values({
        userId,
        orgId: orgId ?? null,
        originalQuery: query,
        optimizedQuery: llmResult.optimized_query,
        explanation: llmResult.explanation,
        bottlenecks: llmResult.bottlenecks,
        suggestedIndexes: llmResult.suggested_indexes || [],
        estimatedImprovement: llmResult.estimated_improvement,
        executionPlanSummary: llmResult.execution_plan_summary,
        queryComplexityScore: llmResult.query_complexity_score ?? null,
        dbType: db_type,
      }).returning({ id: queryHistoryTable.id });
      savedId = saved?.id ?? null;
    } catch (err) {
      req.log.warn({ err }, "Failed to save query to history");
    }
  }

  const response = AnalyzeQueryResponse.parse({
    id: savedId,
    original_query: query,
    optimized_query: llmResult.optimized_query,
    explanation: llmResult.explanation,
    bottlenecks: llmResult.bottlenecks,
    suggested_indexes: llmResult.suggested_indexes,
    estimated_improvement: llmResult.estimated_improvement,
    execution_plan_summary: llmResult.execution_plan_summary,
    query_complexity_score: llmResult.query_complexity_score ?? null,
    db_type,
    created_at: new Date().toISOString(),
  });

  res.json(response);
});

router.post("/analyze-stream", analyzeLimiter, async (req, res): Promise<void> => {
  const parsed = AnalyzeQueryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { query, db_type, manual_schema, explain_output, db_config } = parsed.data;

  // Setup SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders(); // flush the headers to establish SSE

  const sendEvent = (type: string, data: any) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === 'function') {
      (res as any).flush();
    }
  };

  let schema = manual_schema ?? "";
  let explainOutput = explain_output ?? "";

  // If Live Database mode is used, fetch the actual explain output
  if (db_config && db_config.db_type === "postgresql") {
    try {
      sendEvent("status", "Connecting to PostgreSQL...");
      const client = new pg.Client({
        host: db_config.host,
        port: db_config.port,
        database: db_config.database,
        user: db_config.username,
        password: db_config.password,
        ssl: { rejectUnauthorized: false }
      });
      await client.connect();
      
      sendEvent("status", "Fetching Schema...");
      const schemaRes = await client.query(`
        SELECT table_name, column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public';
      `);
      schema = "Tables and Columns:\n" + JSON.stringify(schemaRes.rows, null, 2);

      sendEvent("status", "Running EXPLAIN ANALYZE...");
      const explainRes = await client.query(`EXPLAIN ANALYZE ${query}`);
      explainOutput = explainRes.rows.map((r: any) => r['QUERY PLAN']).join('\n');
      
      await client.end();
    } catch (err: any) {
      req.log.error({ err }, "Live DB connection failed");
      sendEvent("error", "Failed to run query on Live Database: " + err.message);
      res.end();
      return;
    }
  } else if (db_config && db_config.db_type === "mysql") {
    try {
      sendEvent("status", "Connecting to MySQL...");
      const mysql = await import("mysql2/promise");
      const connection = await mysql.createConnection({
        host: db_config.host,
        port: db_config.port,
        user: db_config.username,
        password: db_config.password,
        database: db_config.database,
      });

      sendEvent("status", "Fetching Schema...");
      const [schemaRes] = await connection.query(`
        SELECT table_name, column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = ?;
      `, [db_config.database]);
      schema = "Tables and Columns:\n" + JSON.stringify(schemaRes, null, 2);

      sendEvent("status", "Running EXPLAIN ANALYZE...");
      const [explainRes]: any = await connection.query(`EXPLAIN ANALYZE ${query}`);
      explainOutput = explainRes.map((r: any) => Object.values(r)[0]).join('\n');

      await connection.end();
    } catch (err: any) {
      req.log.error({ err }, "Live MySQL connection failed");
      sendEvent("error", "Failed to run query on Live MySQL Database: " + err.message);
      res.end();
      return;
    }
  }

  sendEvent("status", "Parsing bottlenecks...");
  const explainResult = parseExplainOutput(explainOutput, db_type);

  sendEvent("raw_explain", explainOutput);
  sendEvent("bottlenecks", explainResult.bottlenecks);

  let fullResponse = "";
  try {
    sendEvent("status", "AI Analyzing...");
    await streamOptimizeQuery({
      query,
      schema,
      explainOutput,
      bottlenecks: explainResult.bottlenecks,
      dbType: db_type,
      onChunk: (chunk) => {
        fullResponse += chunk;
        sendEvent("chunk", chunk);
      }
    });
  } catch (err: any) {
    req.log.error({ err }, "LLM optimization failed");
    sendEvent("error", "Failed to optimize query. Please check your NVIDIA API key and try again.");
    res.end();
    return;
  }

  // Parse the full response to save to history
  let clean = fullResponse.trim();
  const jsonMatch = fullResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    clean = jsonMatch[1].trim();
  } else {
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
      clean = clean.substring(firstBrace, lastBrace + 1).trim();
    }
  }

  let llmResult;
  try {
    llmResult = JSON.parse(clean);
  } catch(e) {
    req.log.warn({ e, clean }, "Could not parse streamed response as JSON to save to history");
  }

  const auth = getAuth(req);
  const userId = auth?.userId;
  const orgId = auth?.orgId;
  let savedId: number | null = null;

  if (userId && llmResult) {
    try {
      const [saved] = await db.insert(queryHistoryTable).values({
        userId,
        orgId: orgId ?? null,
        originalQuery: query,
        optimizedQuery: llmResult.optimized_query || "",
        explanation: llmResult.explanation || "",
        bottlenecks: llmResult.bottlenecks || explainResult.bottlenecks,
        suggestedIndexes: llmResult.suggested_indexes || [],
        estimatedImprovement: llmResult.estimated_improvement || "",
        executionPlanSummary: llmResult.execution_plan_summary || "",
        queryComplexityScore: llmResult.query_complexity_score ?? null,
        dbType: db_type,
      }).returning({ id: queryHistoryTable.id });
      savedId = saved?.id ?? null;
      sendEvent("savedId", savedId);
    } catch (err) {
      req.log.warn({ err }, "Failed to save query to history");
    }
  }

  sendEvent("done", true);
  res.end();
});

export default router;
