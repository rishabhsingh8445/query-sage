import { pgTable, serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const queryHistoryTable = pgTable("query_history", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  orgId: text("org_id"),
  originalQuery: text("original_query").notNull(),
  optimizedQuery: text("optimized_query").notNull(),
  explanation: text("explanation").notNull(),
  bottlenecks: jsonb("bottlenecks").notNull().$type<Array<{
    type: string;
    table: string | null;
    description: string;
    severity: string;
  }>>(),
  suggestedIndexes: jsonb("suggested_indexes").notNull().$type<Array<{
    statement: string;
    reason: string;
  }>>(),
  estimatedImprovement: text("estimated_improvement").notNull(),
  executionPlanSummary: text("execution_plan_summary").notNull(),
  dbType: text("db_type").notNull(),
  queryComplexityScore: integer("query_complexity_score"),
  shareId: text("share_id").unique(),
  chatHistory: jsonb("chat_history").default('[]').notNull().$type<Array<{
    role: "user" | "assistant";
    content: string;
  }>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertQueryHistorySchema = createInsertSchema(queryHistoryTable).omit({ id: true, createdAt: true });
export type InsertQueryHistory = z.infer<typeof insertQueryHistorySchema>;
export type QueryHistory = typeof queryHistoryTable.$inferSelect;
