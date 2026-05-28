import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import OpenAI from "openai";
import { logger } from "../lib/logger";
import rateLimit from "express-rate-limit";

const migrateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many requests, please try again later." },
});

const router: IRouter = Router();

const openaiClient = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

const MigrateBody = z.object({
  query: z.string().min(5),
  source_db: z.enum(["postgresql", "mysql", "sqlserver", "oracle", "sqlite"]),
  target_db: z.enum(["postgresql", "mysql", "sqlserver", "oracle", "sqlite"]),
});

router.post("/migrate", migrateLimiter, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = MigrateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { query, source_db, target_db } = parsed.data;

  if (source_db === target_db) {
    res.status(400).json({ error: "Source and target databases must be different." });
    return;
  }

  try {
    const systemPrompt = `You are an expert Database Migration Specialist.
Your task is to translate a SQL query written for ${source_db} so that it works perfectly on ${target_db}.
Pay close attention to:
- Date/time functions (e.g., DATE_ADD vs INTERVAL, GETDATE() vs NOW())
- String concatenation (e.g., CONCAT vs ||)
- Type casting (e.g., ::type vs CAST())
- JSON functions
- Window functions syntax quirks

Return a JSON object containing:
- migrated_query: the fully translated SQL query
- explanation: a concise explanation of the syntax changes made`;

    const completion = await openaiClient.chat.completions.create({
      model: "meta/llama-3.3-70b-instruct",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Original ${source_db} Query:\n${query}` }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
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
    res.json({
      original_query: query,
      migrated_query: parsedResponse.migrated_query,
      explanation: parsedResponse.explanation,
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to migrate query");
    res.status(500).json({ error: "Failed to migrate query: " + err.message });
  }
});

export { router as migrateRouter };
