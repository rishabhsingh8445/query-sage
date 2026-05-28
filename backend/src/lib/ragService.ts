import { qdrantClient, SCHEMA_COLLECTION_NAME } from './qdrant';
import OpenAI from "openai";
import { logger } from "./logger";
import crypto from "crypto";

const openaiClient = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

/**
 * Generate a vector embedding for a given text using OpenAI.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await openaiClient.embeddings.create({
      model: "nvidia/nv-embedqa-e5-v5",
      input: text,
    });
    return response.data[0].embedding;
  } catch (err) {
    logger.error({ err }, "Error generating embedding:");
    throw new Error("Failed to generate embedding");
  }
}

/**
 * Store a chunk of schema DDL into Qdrant.
 */
export async function storeSchemaChunk(workspaceId: string, tableName: string, schemaDdl: string) {
  try {
    const vector = await generateEmbedding(schemaDdl);
    
    await qdrantClient.upsert(SCHEMA_COLLECTION_NAME, {
      wait: true,
      points: [
        {
          id: crypto.randomUUID(),
          vector: vector,
          payload: {
            workspace_id: workspaceId,
            table_name: tableName,
            schema_ddl: schemaDdl,
          },
        },
      ],
    });
    logger.info(`Stored schema chunk for table ${tableName} in Qdrant.`);
  } catch (err) {
    logger.error({ err }, `Error indexing schema ${tableName}:`);
    throw new Error("Failed to store schema chunk");
  }
}

/**
 * Search Qdrant for the most relevant schema definitions based on a user query.
 */
export async function searchRelevantSchema(workspaceId: string, query: string, limit = 5) {
  try {
    const queryVector = await generateEmbedding(query);
    
    const searchResults = await qdrantClient.search(SCHEMA_COLLECTION_NAME, {
      vector: queryVector,
      limit,
      filter: {
        must: [
          {
            key: "workspace_id",
            match: {
              value: workspaceId
            }
          }
        ]
      }
    });

    return searchResults;
  } catch (err) {
    logger.error({ err }, "Error searching relevant schema:");
    throw new Error("Failed to search schema");
  }
}
