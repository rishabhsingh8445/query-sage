import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import pg from "pg";
import { z } from "zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const MonitorBody = z.object({
  db_type: z.enum(["postgresql", "mysql"]).optional().default("postgresql"),
  host: z.string(),
  port: z.number(),
  database: z.string(),
  username: z.string(),
  password: z.string(),
});

router.post("/monitor/slow-queries", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = MonitorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const dbConfig = parsed.data;

  try {
    if (dbConfig.db_type === "postgresql") {
      const client = new pg.Client({
        host: dbConfig.host,
        port: dbConfig.port,
        database: dbConfig.database,
        user: dbConfig.username,
        password: dbConfig.password,
        ssl: { rejectUnauthorized: false },
      });
      
      await client.connect();

      try {
        await client.query(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`);
      } catch (e) {}

      const query = `
        SELECT 
          query, 
          calls, 
          total_exec_time / 1000 AS total_exec_seconds, 
          mean_exec_time AS mean_exec_ms, 
          max_exec_time AS max_exec_ms,
          rows
        FROM pg_stat_statements 
        WHERE query NOT ILIKE '%pg_stat_statements%' 
          AND query NOT ILIKE '%COMMIT%' 
          AND query NOT ILIKE '%BEGIN%'
        ORDER BY total_exec_time DESC 
        LIMIT 20;
      `;

      const result = await client.query(query);
      await client.end();

      res.json({
        success: true,
        queries: result.rows.map(r => ({
          query: r.query,
          calls: Number(r.calls),
          total_time_sec: Number(r.total_exec_seconds).toFixed(2),
          mean_time_ms: Number(r.mean_exec_ms).toFixed(2),
          max_time_ms: Number(r.max_exec_ms).toFixed(2),
          rows: Number(r.rows),
        }))
      });

    } else if (dbConfig.db_type === "mysql") {
      const mysql = await import("mysql2/promise");
      const connection = await mysql.createConnection({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.username,
        password: dbConfig.password,
        database: dbConfig.database,
      });

      const query = `
        SELECT 
          DIGEST_TEXT AS query,
          COUNT_STAR AS calls,
          SUM_TIMER_WAIT / 1000000000000 AS total_exec_seconds,
          AVG_TIMER_WAIT / 1000000000 AS mean_exec_ms,
          MAX_TIMER_WAIT / 1000000000 AS max_exec_ms,
          SUM_ROWS_SENT AS rows
        FROM performance_schema.events_statements_summary_by_digest
        WHERE DIGEST_TEXT IS NOT NULL
          AND DIGEST_TEXT NOT LIKE '%performance_schema%'
        ORDER BY SUM_TIMER_WAIT DESC
        LIMIT 20;
      `;

      const [rows]: any = await connection.query(query);
      await connection.end();

      res.json({
        success: true,
        queries: rows.map((r: any) => ({
          query: r.query,
          calls: Number(r.calls),
          total_time_sec: Number(r.total_exec_seconds).toFixed(2),
          mean_time_ms: Number(r.mean_exec_ms).toFixed(2),
          max_time_ms: Number(r.max_exec_ms).toFixed(2),
          rows: Number(r.rows),
        }))
      });
    }

  } catch (err: any) {
    logger.error({ err }, "Failed to fetch slow queries");
    if (err.message.includes("pg_stat_statements")) {
      res.status(400).json({ 
        error: "pg_stat_statements extension is not installed or enabled in shared_preload_libraries on the target database." 
      });
    } else if (err.message.includes("performance_schema")) {
      res.status(400).json({ 
        error: "performance_schema is not enabled on the target MySQL database." 
      });
    } else {
      res.status(400).json({ error: "Failed to connect or fetch queries: " + err.message });
    }
  }
});

export { router as monitorRouter };
