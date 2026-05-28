import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import fs from "fs";

let envDir = path.dirname(fileURLToPath(import.meta.url));
while (!fs.existsSync(path.join(envDir, ".env")) && envDir !== path.parse(envDir).root) {
  envDir = path.resolve(envDir, "..");
}
config({ path: path.join(envDir, ".env") });

import app from "./app";
import { logger } from "./lib/logger";
import { initializeQdrant } from "./lib/qdrant";

const rawPort = process.env["PORT"];

// Initialize Qdrant collection in the background
initializeQdrant().catch(err => logger.error("Error initializing Qdrant:", err));

// Start the background cron jobs
// (Removed audit job)

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
