import { QdrantClient } from '@qdrant/js-client-rest';
import { logger } from './logger';

const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
const qdrantApiKey = process.env.QDRANT_API_KEY || '';

export const qdrantClient = new QdrantClient({
  url: qdrantUrl,
  apiKey: qdrantApiKey,
});

export const SCHEMA_COLLECTION_NAME = 'schema_embeddings';

/**
 * Initializes the Qdrant collection for schema embeddings if it doesn't already exist.
 */
export async function initializeQdrant() {
  try {
    const collections = await qdrantClient.getCollections();
    const collectionExists = collections.collections.some(
      (c) => c.name === SCHEMA_COLLECTION_NAME
    );

    if (!collectionExists) {
      logger.info(`Creating Qdrant collection: ${SCHEMA_COLLECTION_NAME}`);
      await qdrantClient.createCollection(SCHEMA_COLLECTION_NAME, {
        vectors: {
          size: 1536, // text-embedding-3-small dimension size
          distance: 'Cosine',
        },
      });
      logger.info(`Successfully created Qdrant collection: ${SCHEMA_COLLECTION_NAME}`);
    } else {
      logger.info(`Qdrant collection ${SCHEMA_COLLECTION_NAME} already exists.`);
    }
  } catch (err) {
    logger.error({ err }, 'Failed to initialize Qdrant collection:');
    // Don't throw here to prevent the app from crashing if Qdrant isn't available yet
  }
}
