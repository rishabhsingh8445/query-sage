import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { db, queryHistoryTable } from "@workspace/db";
import {
  GetHistoryResponse,
  GetHistoryEntryParams,
  GetHistoryEntryResponse,
  DeleteHistoryEntryParams,
  GetStatsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function requireAuth(req: any, res: any, next: any): void {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = auth.userId;
  req.orgId = auth.orgId;
  next();
}

router.get("/history", requireAuth, async (req: any, res): Promise<void> => {
  const filterCondition = req.orgId 
    ? eq(queryHistoryTable.orgId, req.orgId)
    : eq(queryHistoryTable.userId, req.userId);

  const rows = await db
    .select()
    .from(queryHistoryTable)
    .where(filterCondition)
    .orderBy(desc(queryHistoryTable.createdAt));

  res.json(GetHistoryResponse.parse(rows.map(r => {
    let safeBottlenecks = r.bottlenecks as any[];
    if (Array.isArray(safeBottlenecks)) {
      safeBottlenecks = safeBottlenecks.map(b => ({
        ...b,
        severity: typeof b.severity === 'string' ? b.severity.toUpperCase() : "MEDIUM"
      }));
    }
    
    const rawIndexes = (r.suggestedIndexes as any[]) || [];
    const parsedIndexes = rawIndexes.map((idx: any) => {
      if (typeof idx === 'string') {
        if (idx.trim().startsWith('{')) {
          try { return JSON.parse(idx); } catch (e) { return { statement: idx, reason: '' }; }
        }
        return { statement: idx, reason: '' };
      }
      return idx;
    });

    return {
      ...r,
      bottlenecks: safeBottlenecks || [],
      suggested_indexes: parsedIndexes,
      id: r.id,
      original_query: r.originalQuery || "",
      optimized_query: r.optimizedQuery || "",
      explanation: r.explanation || "",
      estimated_improvement: r.estimatedImprovement || "",
      execution_plan_summary: r.executionPlanSummary || "",
      db_type: r.dbType || "postgresql",
      query_complexity_score: r.queryComplexityScore ?? 0,
      created_at: r.createdAt.toISOString(),
      user_id: r.userId || "",
      share_id: r.shareId,
    };
  })));
});

router.delete("/history", requireAuth, async (req: any, res): Promise<void> => {
  const filterCondition = req.orgId 
    ? eq(queryHistoryTable.orgId, req.orgId)
    : eq(queryHistoryTable.userId, req.userId);

  await db.delete(queryHistoryTable).where(filterCondition);
  res.sendStatus(204);
});

router.get("/history/:id", requireAuth, async (req: any, res): Promise<void> => {
  const params = GetHistoryEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const filterCondition = req.orgId 
    ? eq(queryHistoryTable.orgId, req.orgId)
    : eq(queryHistoryTable.userId, req.userId);

  const [row] = await db
    .select()
    .from(queryHistoryTable)
    .where(and(eq(queryHistoryTable.id, params.data.id), filterCondition));

  if (!row) {
    res.status(404).json({ error: "History entry not found" });
    return;
  }

  let safeBottlenecks = row.bottlenecks as any[];
  if (Array.isArray(safeBottlenecks)) {
    safeBottlenecks = safeBottlenecks.map(b => ({
      ...b,
      severity: typeof b.severity === 'string' ? b.severity.toUpperCase() : "MEDIUM"
    }));
  }

  const rawIndexes = (row.suggestedIndexes as any[]) || [];
  const parsedIndexes = rawIndexes.map((idx: any) => {
    if (typeof idx === 'string') {
      if (idx.trim().startsWith('{')) {
        try { return JSON.parse(idx); } catch (e) { return { statement: idx, reason: '' }; }
      }
      return { statement: idx, reason: '' };
    }
    return idx;
  });

  res.json(GetHistoryEntryResponse.parse({
    id: row.id,
    original_query: row.originalQuery || "",
    optimized_query: row.optimizedQuery || "",
    explanation: row.explanation || "",
    bottlenecks: safeBottlenecks || [],
    suggested_indexes: parsedIndexes,
    estimated_improvement: row.estimatedImprovement || "",
    execution_plan_summary: row.executionPlanSummary || "",
    db_type: row.dbType || "postgresql",
    query_complexity_score: row.queryComplexityScore ?? 0,
    created_at: row.createdAt.toISOString(),
    user_id: row.userId || "",
    share_id: row.shareId,
  }));
});

router.delete("/history/:id", requireAuth, async (req: any, res): Promise<void> => {
  const params = DeleteHistoryEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const filterCondition = req.orgId 
    ? eq(queryHistoryTable.orgId, req.orgId)
    : eq(queryHistoryTable.userId, req.userId);

  const [deleted] = await db
    .delete(queryHistoryTable)
    .where(and(eq(queryHistoryTable.id, params.data.id), filterCondition))
    .returning({ id: queryHistoryTable.id });

  if (!deleted) {
    res.status(404).json({ error: "History entry not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/stats", requireAuth, async (req: any, res): Promise<void> => {
  const filterCondition = req.orgId 
    ? eq(queryHistoryTable.orgId, req.orgId)
    : eq(queryHistoryTable.userId, req.userId);

  const rows = await db
    .select()
    .from(queryHistoryTable)
    .where(filterCondition);

  const total = rows.length;
  const pgCount = rows.filter(r => r.dbType === "postgresql").length;
  const mysqlCount = rows.filter(r => r.dbType === "mysql").length;

  const bottleneckCounts: Record<string, number> = {};
  for (const row of rows) {
    const bns = row.bottlenecks as Array<{ type: string }>;
    for (const bn of bns) {
      bottleneckCounts[bn.type] = (bottleneckCounts[bn.type] ?? 0) + 1;
    }
  }

  const topBottlenecks = Object.entries(bottleneckCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }));

  res.json(GetStatsResponse.parse({
    total_optimizations: total,
    postgresql_count: pgCount,
    mysql_count: mysqlCount,
    top_bottleneck_types: topBottlenecks,
  }));
});

export default router;
