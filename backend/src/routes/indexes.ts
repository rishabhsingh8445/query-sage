import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import pg from "pg";
import { db, queryHistoryTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const EstimateIndexBody = z.object({
  query: z.string(),
  index_statement: z.string(),
  db_type: z.enum(["postgresql", "mysql"]),
  db_config: z.object({
    host: z.string(),
    port: z.number(),
    database: z.string(),
    username: z.string(),
    password: z.string(),
  }),
});

router.post("/indexes/estimate", async (req, res): Promise<void> => {
  const parsed = EstimateIndexBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { query, index_statement, db_type, db_config } = parsed.data;

  let speedupFactor = 1.0;
  let simulated = false;
  let originalCost = 0;
  let newCost = 0;

  if (db_type === "postgresql") {
    let client: pg.Client | null = null;
    try {
      client = new pg.Client({
        host: db_config.host,
        port: db_config.port,
        database: db_config.database,
        user: db_config.username,
        password: db_config.password,
        ssl: { rejectUnauthorized: false },
      });
      await client.connect();

      // 1. Get original cost
      const origExplain = await client.query(`EXPLAIN (FORMAT JSON) ${query}`);
      originalCost = origExplain.rows[0]['QUERY PLAN'][0]['Plan']['Total Cost'];

      // 2. Try to use hypopg
      try {
        await client.query(`CREATE EXTENSION IF NOT EXISTS hypopg;`);
        
        // Convert CREATE INDEX to hypopg syntax if needed, but hypopg_create_index takes standard CREATE INDEX string
        await client.query(`SELECT * FROM hypopg_create_index($1)`, [index_statement]);

        // 3. Get new cost
        const newExplain = await client.query(`EXPLAIN (FORMAT JSON) ${query}`);
        newCost = newExplain.rows[0]['QUERY PLAN'][0]['Plan']['Total Cost'];

        // Clean up hypothetical indexes
        await client.query(`SELECT * FROM hypopg_reset();`);

        if (originalCost > 0 && newCost < originalCost) {
          speedupFactor = originalCost / newCost;
          simulated = true;
        } else if (newCost >= originalCost) {
          speedupFactor = 1.0; // No improvement
          simulated = true;
        }

      } catch (hypoErr: any) {
        logger.warn({ hypoErr }, "HypoPG not available or failed. Falling back to heuristic.");
        // Fallback heuristic: Assume a default 2x - 10x speedup depending on cost for demo/estimation purposes
        // In a production app, we would use an LLM or AST heuristic here.
        if (originalCost > 1000) speedupFactor = 5.2;
        else if (originalCost > 100) speedupFactor = 3.1;
        else speedupFactor = 1.5;
        simulated = false;
      }
    } catch (err: any) {
      logger.error({ err }, "Failed to connect to target DB for index estimation");
      res.status(400).json({ error: "Failed to connect to target DB: " + err.message });
      return;
    } finally {
      if (client) await client.end();
    }
  } else {
    // MySQL does not have a hypopg equivalent natively (MySQL 8 has invisible indexes, but not hypothetical ones easily queryable like this).
    // Fallback heuristic
    speedupFactor = 2.5; 
  }

  // Calculate Impact Radius (Affects X queries)
  // We'll extract the table name from the index statement using regex: ON table_name (
  let impactCount = 0;
  try {
    const tableMatch = index_statement.match(/ON\s+([a-zA-Z0-9_]+)\s*\(/i);
    if (tableMatch && tableMatch[1]) {
      const tableName = tableMatch[1];
      
      // Search query history for this table name
      const historyRes = await db
        .select({ count: sql<number>`count(*)` })
        .from(queryHistoryTable)
        .where(
          sql`${queryHistoryTable.userId} = ${auth.userId} AND ${queryHistoryTable.originalQuery} ILIKE ${'%' + tableName + '%'}`
        );
        
      impactCount = Number(historyRes[0]?.count || 0);
    }
  } catch (e) {
    logger.error({ e }, "Failed to calculate impact radius");
  }

  res.json({
    simulated,
    original_cost: originalCost,
    new_cost: newCost,
    speedup_factor: Number(speedupFactor.toFixed(1)),
    impact_count: impactCount,
    message: simulated 
      ? `Simulated via HypoPG. Expected speedup: ${speedupFactor.toFixed(1)}x` 
      : `Estimated heuristic speedup: ${speedupFactor.toFixed(1)}x`,
  });
});

export { router as indexesRouter };
