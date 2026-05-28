import { Router, type IRouter } from "express";
import { z } from "zod";
import pg from "pg";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const EstimateBody = z.object({
  query: z.string(),
  db_config: z.object({
    db_type: z.enum(["postgresql", "mysql"]),
    host: z.string(),
    port: z.number(),
    database: z.string(),
    username: z.string(),
    password: z.string().optional(),
  })
});

router.post("/queries/estimate", async (req, res): Promise<void> => {
  const parsed = EstimateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { query, db_config } = parsed.data;

  try {
    let cost = 0;
    let rows = 0;
    let riskLevel = "LOW";
    let message = "";

    if (db_config.db_type === "postgresql") {
      const client = new pg.Client({
        host: db_config.host,
        port: db_config.port,
        database: db_config.database,
        user: db_config.username,
        password: db_config.password,
        ssl: { rejectUnauthorized: false }
      });
      await client.connect();

      // Ensure we only run EXPLAIN, not EXPLAIN ANALYZE, so we don't execute it!
      const explainRes = await client.query(`EXPLAIN (FORMAT JSON) ${query}`);
      await client.end();

      const plan = explainRes.rows[0]["QUERY PLAN"][0].Plan;
      cost = plan["Total Cost"] || 0;
      rows = plan["Plan Rows"] || 0;

      if (cost > 10000) riskLevel = "HIGH";
      else if (cost > 1000) riskLevel = "MEDIUM";

      message = `PostgreSQL estimates this query will cost ${cost.toFixed(2)} and return ~${rows} rows.`;
      
    } else if (db_config.db_type === "mysql") {
      const mysql = await import("mysql2/promise");
      const connection = await mysql.createConnection({
        host: db_config.host,
        port: db_config.port,
        user: db_config.username,
        password: db_config.password,
        database: db_config.database,
      });

      const [explainRes]: any = await connection.query(`EXPLAIN FORMAT=JSON ${query}`);
      await connection.end();

      const plan = JSON.parse(explainRes[0].EXPLAIN);
      cost = parseFloat(plan?.query_block?.cost_info?.query_cost || "0");
      rows = parseInt(plan?.query_block?.table?.rows_examined_per_scan || plan?.query_block?.rows_examined_per_scan || "0", 10);

      if (cost > 10000) riskLevel = "HIGH";
      else if (cost > 1000) riskLevel = "MEDIUM";

      message = `MySQL estimates this query has a cost of ${cost.toFixed(2)}.`;
    }

    res.json({
      cost,
      rows,
      risk_level: riskLevel,
      message
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to estimate query cost");
    res.status(500).json({ error: "Failed to estimate cost: " + err.message });
  }
});

export { router as estimateRouter };
