import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import fs from "fs";

let envDir = path.dirname(fileURLToPath(import.meta.url));
while (!fs.existsSync(path.join(envDir, ".env")) && envDir !== path.parse(envDir).root) {
  envDir = path.resolve(envDir, "..");
}
config({ path: path.join(envDir, ".env") });

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
