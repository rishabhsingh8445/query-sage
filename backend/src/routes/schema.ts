import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { storeSchemaChunk } from "../lib/ragService";
import { z } from "zod";

const router: IRouter = Router();

const SyncSchemaBody = z.object({
  table_name: z.string(),
  schema_ddl: z.string(),
});

router.post("/schema/sync", async (req, res): Promise<void> => {
  const parsed = SyncSchemaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { table_name, schema_ddl } = parsed.data;

  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    // Note: Using auth.userId as workspace_id until Workspaces are fully set up
    await storeSchemaChunk(auth.userId, table_name, schema_ddl);
    res.json({ success: true, message: `Schema for ${table_name} synced to vector store.` });
  } catch (err: any) {
    req.log.error({ err }, "Failed to sync schema chunk");
    res.status(500).json({ error: "Failed to sync schema to vector database" });
  }
});

export { router as schemaRouter };
