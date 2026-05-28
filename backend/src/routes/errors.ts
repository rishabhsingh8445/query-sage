import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import OpenAI from "openai";
import { logger } from "../lib/logger";
import rateLimit from "express-rate-limit";

const errorLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many requests from this IP, please try again after a minute." },
  standardHeaders: true,
  legacyHeaders: false,
});

const router: IRouter = Router();

const openaiClient = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

const ExplainErrorBody = z.object({
  query: z.string(),
  error_message: z.string(),
  db_type: z.enum(["postgresql", "mysql"]),
  schema: z.string().optional(),
});

router.post("/errors/explain", errorLimiter, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = ExplainErrorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { query, error_message, db_type, schema } = parsed.data;

  try {
    const systemPrompt = `You are an expert Database Administrator resolving a SQL error for a ${db_type} database.
You will be given the faulty query, the database error message, and optionally the database schema.
Your goal is to explain exactly why the error occurred and provide a corrected, working SQL query.
Return a JSON object containing:
- explanation: a clear, concise explanation of the error
- corrected_query: the fixed SQL query`;

    const completion = await openaiClient.chat.completions.create({
      model: "meta/llama-3.1-70b-instruct",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Query:\n${query}\n\nError Message:\n${error_message}\n\nSchema:\n${schema || 'Not provided'}` }
      ],
      temperature: 0.2,
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
    res.json(parsedResponse);
  } catch (err: any) {
    logger.error({ err }, "Failed to explain SQL error");
    res.status(500).json({ error: "Failed to explain SQL error: " + err.message });
  }
});

export { router as errorsRouter };
