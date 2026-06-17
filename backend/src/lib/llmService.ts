import OpenAI from "openai";
import { logger } from "./logger";

const client = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

const SYSTEM_PROMPT = `You are QuerySage, an expert database performance engineer specializing in PostgreSQL and MySQL query optimization. You have deep knowledge of query execution plans, index strategies, join algorithms, and the query planner internals.

You will receive:
1. A slow SQL query
2. The database schema (DDL) — may be "Not provided"
3. The EXPLAIN ANALYZE output and detected bottlenecks — may be "Not provided"
4. The database type (postgresql/mysql)

You must respond ONLY with valid JSON matching this exact structure:
{
  "optimized_query": "<rewritten SQL>",
  "explanation": "<detailed explanation of every change made and why>",
  "bottlenecks": [
    {"type": "SEQ_SCAN", "table": "orders", "description": "...", "severity": "HIGH"}
  ],
  "suggested_indexes": [
    {
      "statement": "CREATE INDEX idx_orders_user_id ON orders(user_id);",
      "reason": "Allows quick lookup of orders by user_id for the WHERE clause."
    }
  ],
  "estimated_improvement": "70-85% reduction in execution time",
  "execution_plan_summary": "The planner chose a sequential scan on orders (2.3M rows) because no index exists on user_id.",
  "query_complexity_score": 85
}

Bottleneck types: SEQ_SCAN, MISSING_INDEX, CARTESIAN_PRODUCT, BAD_JOIN_ORDER, INEFFICIENT_SUBQUERY
Severity levels: HIGH, MEDIUM, LOW

Rules:
- The optimized query MUST be semantically equivalent to the original
- Never change the result set, only the execution strategy
- Suggest indexes only if they don't already exist in the schema
- For PostgreSQL, consider partial indexes, covering indexes, composite index column order
- If no schema or EXPLAIN is provided, analyze the query structure alone and make reasonable recommendations
- Respond with raw JSON only — no markdown fences, no preamble, no explanation outside the JSON`;

function buildUserMessage(params: {
  dbType: string;
  query: string;
  schema: string;
  explainOutput: string;
  bottlenecks: unknown[];
}): string {
  return `Database Type: ${params.dbType}

Original Query:
${params.query}

Schema:
${params.schema}

EXPLAIN ANALYZE Output:
${params.explainOutput}

Detected Bottlenecks:
${JSON.stringify(params.bottlenecks, null, 2)}

Optimize this query and respond in the JSON format specified.`;
}

export interface ExplainNode {
  node_type: string;
  cost?: string;
  rows?: string;
  execution_time?: string;
  children?: ExplainNode[];
}

export interface LLMOptimizationResult {
  optimized_query: string;
  explanation: string;
  bottlenecks: Array<{
    type: string;
    table: string | null;
    description: string;
    severity: string;
  }>;
  suggested_indexes: Array<{ statement: string; reason: string }>;
  estimated_improvement: string;
  execution_plan_summary: string;
  query_complexity_score: number;
  execution_plan_tree?: ExplainNode;
}

export async function optimizeQuery(params: {
  query: string;
  schema: string;
  explainOutput: string;
  bottlenecks: unknown[];
  dbType: string;
}): Promise<LLMOptimizationResult> {
  const userMessage = buildUserMessage({
    dbType: params.dbType,
    query: params.query,
    schema: params.schema || "Not provided",
    explainOutput: params.explainOutput || "Not provided",
    bottlenecks: params.bottlenecks || [],
  });

  logger.info({ dbType: params.dbType }, "Calling NVIDIA NIM API");

  const completion = await client.chat.completions.create({
    model: "meta/llama-3.3-70b-instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.1,
    max_tokens: 4000,
  });

  const raw = completion.choices[0]?.message?.content ?? "";

  let clean = raw.trim();
  if (clean.startsWith("```")) {
    const parts = clean.split("```");
    clean = parts[1] ?? "";
    if (clean.startsWith("json")) {
      clean = clean.slice(4);
    }
  }
  clean = clean.trim();

  return JSON.parse(clean) as LLMOptimizationResult;
}

export async function streamOptimizeQuery(params: {
  query: string;
  schema: string;
  explainOutput: string;
  bottlenecks: unknown[];
  dbType: string;
  onChunk: (chunk: string) => void;
}): Promise<void> {
  const userMessage = buildUserMessage({
    dbType: params.dbType,
    query: params.query,
    schema: params.schema || "Not provided",
    explainOutput: params.explainOutput || "Not provided",
    bottlenecks: params.bottlenecks || [],
  });

  logger.info({ dbType: params.dbType }, "Calling NVIDIA NIM API (Streaming)");

  const stream = await client.chat.completions.create({
    model: "meta/llama-3.3-70b-instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.1,
    max_tokens: 4000,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) {
      params.onChunk(content);
    }
  }
}

export async function streamChatResponse(params: {
  chatHistory: Array<{ role: "user" | "assistant", content: string }>;
  context: string;
  onChunk: (chunk: string) => void;
}): Promise<string> {
  const messages: any[] = [
    { role: "system", content: "You are QuerySage, an expert database performance engineer and AI assistant. Your goal is to help users understand their SQL queries, performance bottlenecks, schema, and indexes.\n\nYou must act like an elite DBA:\n- Always use Markdown (bolding, lists, code blocks) to make your answers structured and easy to read.\n- Be highly organized, clear, and professional, yet friendly and conversational (like a senior colleague helping out).\n- Use headings and bullet points where appropriate.\n- Refer to the user's specific context, schema tables, or past queries directly when answering." },
    { role: "user", content: `Here is my current context and history:\n${params.context}\n\nPlease keep this context in mind to provide highly personalized answers.` },
    { role: "assistant", content: "I have reviewed your database schema and query history! How can I assist you with your database performance today?" },
    ...params.chatHistory.map(msg => ({ role: msg.role, content: msg.content }))
  ];

  logger.info("Calling NVIDIA NIM API for follow-up chat");

  const stream = await client.chat.completions.create({
    model: "meta/llama-3.1-8b-instruct", // Faster model for chat
    messages,
    temperature: 0.5,
    max_tokens: 1000,
    stream: true,
  });

  let fullResponse = "";
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) {
      fullResponse += content;
      params.onChunk(content);
    }
  }

  return fullResponse;
}
