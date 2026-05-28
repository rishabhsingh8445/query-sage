import { Router } from "express";
import { db } from "@workspace/db";
import { queryHistoryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getAuth } from "@clerk/express";

const router = Router();

function requireAuth(req: any, res: any, next: any): void {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = auth.userId;
  next();
}

// Create a shareable link
router.post("/", requireAuth, async (req: any, res) => {
  try {
    const { history_id } = req.body;
    const userId = req.userId;

    const history = await db.query.queryHistoryTable.findFirst({
      where: (table: any, { eq, and }: any) =>
        and(eq(table.id, history_id), eq(table.userId, userId)),
    });

    if (!history) {
      return res.status(404).json({ error: "History entry not found" });
    }

    if (history.shareId) {
      return res.json({ share_id: history.shareId });
    }

    const shareId = nanoid(10);
    await db
      .update(queryHistoryTable)
      .set({ shareId })
      .where(eq(queryHistoryTable.id, history_id));

    return res.json({ share_id: shareId });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get a shared report (public endpoint)
router.get("/:share_id", async (req, res) => {
  try {
    const { share_id } = req.params;

    const history = await db.query.queryHistoryTable.findFirst({
      where: (table, { eq }) => eq(table.shareId, share_id),
    });

    if (!history) {
      return res.status(404).json({ error: "Shared report not found" });
    }

    let safeBottlenecks = history.bottlenecks as any[];
    if (Array.isArray(safeBottlenecks)) {
      safeBottlenecks = safeBottlenecks.map(b => ({
        ...b,
        severity: typeof b.severity === 'string' ? b.severity.toUpperCase() : "MEDIUM"
      }));
    }

    const rawIndexes = (history.suggestedIndexes as any[]) || [];
    const parsedIndexes = rawIndexes.map((idx: any) => {
      if (typeof idx === 'string' && idx.trim().startsWith('{')) {
        try { return JSON.parse(idx); } catch (e) { return { statement: idx, reason: '' }; }
      }
      return idx;
    });

    return res.json({
      id: history.id,
      original_query: history.originalQuery || "",
      optimized_query: history.optimizedQuery || "",
      explanation: history.explanation || "",
      bottlenecks: safeBottlenecks || [],
      suggested_indexes: parsedIndexes,
      estimated_improvement: history.estimatedImprovement || "",
      execution_plan_summary: history.executionPlanSummary || "",
      db_type: history.dbType || "postgresql",
      query_complexity_score: history.queryComplexityScore ?? 0,
      created_at: history.createdAt.toISOString(),
      user_id: history.userId || "",
      share_id: history.shareId,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
