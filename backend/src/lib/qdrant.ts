import { QdrantClient } from '@qdrant/js-client-rest';
import { logger } from './logger';

const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
const qdrantApiKey = process.env.QDRANT_API_KEY || '';

export const qdrantClient = new QdrantClient({
  url: qdrantUrl,
  apiKey: qdrantApiKey,
});

export const SCHEMA_COLLECTION_NAME = 'schema_embeddings';
const VECTOR_SIZE = 1024; // nvidia/nv-embedqa-e5-v5 dimension size

/**
 * Initializes the Qdrant collection for schema embeddings if it doesn't already exist
 * or if the vector size doesn't match.
 */
export async function initializeQdrant() {
  try {
    const collections = await qdrantClient.getCollections();
    const collectionObj = collections.collections.find(
      (c) => c.name === SCHEMA_COLLECTION_NAME
    );

    if (collectionObj) {
      // Check if existing collection has the correct dimension
      const collectionInfo = await qdrantClient.getCollection(SCHEMA_COLLECTION_NAME);
      const existingSize = (collectionInfo.config.params.vectors as any)?.size;
      
      if (existingSize !== VECTOR_SIZE) {
        logger.warn(`Qdrant collection ${SCHEMA_COLLECTION_NAME} has wrong dimension (${existingSize}). Recreating with size ${VECTOR_SIZE}...`);
        await qdrantClient.deleteCollection(SCHEMA_COLLECTION_NAME);
      } else {
        logger.info(`Qdrant collection ${SCHEMA_COLLECTION_NAME} exists with correct dimension.`);
        return;
      }
    }

    logger.info(`Creating Qdrant collection: ${SCHEMA_COLLECTION_NAME}`);
    await qdrantClient.createCollection(SCHEMA_COLLECTION_NAME, {
      vectors: {
        size: VECTOR_SIZE,
        distance: 'Cosine',
      },
    });
    logger.info(`Successfully created Qdrant collection: ${SCHEMA_COLLECTION_NAME}`);
  } catch (err) {
    logger.error({ err }, 'Failed to initialize Qdrant collection:');
  }
}
