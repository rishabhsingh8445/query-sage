import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import crypto from "crypto";

export const schemaChatThreadsTable = pgTable("schema_chat_threads", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  messages: jsonb("messages").default('[]').notNull().$type<Array<{
    role: "user" | "assistant";
    content: string;
  }>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSchemaChatThreadSchema = createInsertSchema(schemaChatThreadsTable).omit({ createdAt: true, updatedAt: true });
export type InsertSchemaChatThread = z.infer<typeof insertSchemaChatThreadSchema>;
export type SchemaChatThread = typeof schemaChatThreadsTable.$inferSelect;
