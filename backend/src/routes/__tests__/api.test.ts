import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app';

// Mock Clerk auth
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (req: any, res: any, next: any) => next(),
  requireAuth: () => (req: any, res: any, next: any) => {
    req.auth = { userId: 'test_user_id' };
    next();
  },
  getAuth: () => ({ userId: 'test_user_id' })
}));

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  desc: vi.fn(),
  count: vi.fn(),
  sql: vi.fn(),
}));

// Mock DB
vi.mock('@workspace/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 1 }]),
    delete: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    query: {
      queryHistoryTable: {
        findFirst: vi.fn()
      }
    }
  },
  queryHistoryTable: {
    id: 'id',
    userId: 'userId',
    originalQuery: 'originalQuery',
    createdAt: 'createdAt',
  }
}));

// Mock LLM Service
vi.mock('../../lib/llmService', () => ({
  optimizeQuery: vi.fn().mockResolvedValue({
    optimized_query: 'SELECT * FROM test',
    explanation: 'Optimized',
    bottlenecks: [],
    suggested_indexes: [],
    estimated_improvement: '10%',
    execution_plan_summary: 'Fast',
    query_complexity_score: 10
  }),
  streamOptimizeQuery: vi.fn()
}));

describe('API Routes', () => {
  describe('POST /api/analyze', () => {
    it('should return 400 for invalid input', async () => {
      const res = await request(app)
        .post('/api/analyze')
        .send({ query: '' }); // Invalid, missing db_type
      
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should successfully analyze a query', async () => {
      const res = await request(app)
        .post('/api/analyze')
        .send({
          query: 'SELECT * FROM users',
          db_type: 'postgresql',
          manual_schema: 'users (id INT)',
          explain_output: ''
        });
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('optimized_query');
      expect(res.body.db_type).toBe('postgresql');
    });
  });

  describe('GET /api/history', () => {
    it('should return history array', async () => {
      const { db } = await import('@workspace/db');
      vi.mocked((db as any).orderBy).mockResolvedValueOnce([
        { id: 1, originalQuery: 'SELECT *', dbType: 'postgresql', createdAt: new Date() }
      ] as any);

      const res = await request(app).get('/api/history');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
    });
  });

  describe('GET /api/history/:id', () => {
    it('should return 404 for non-existent history', async () => {
      const { db } = await import('@workspace/db');
      vi.mocked((db as any).where).mockResolvedValueOnce([] as any);

      const res = await request(app).get('/api/history/999');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });

    it('should return history item if found', async () => {
      const { db } = await import('@workspace/db');
      vi.mocked((db as any).where).mockResolvedValueOnce([
        { 
          id: 1, 
          originalQuery: 'SELECT *', 
          optimizedQuery: 'SELECT *',
          explanation: 'exp',
          dbType: 'postgresql', 
          suggestedIndexes: [], 
          bottlenecks: [],
          estimatedImprovement: '10%',
          executionPlanSummary: 'fast',
          queryComplexityScore: 1,
          createdAt: new Date(),
          userId: 'test_user_id',
          shareId: null
        }
      ] as any);

      const res = await request(app).get('/api/history/1');
      if (res.status === 500) console.error('HISTORY 500 ERROR:', res.body);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', 1);
    });
  });

  describe('DELETE /api/history/:id', () => {
    it('should return 404 when deleting non-existent item', async () => {
      const { db } = await import('@workspace/db');
      vi.mocked((db as any).returning).mockResolvedValueOnce([] as any);

      const res = await request(app).delete('/api/history/999');
      expect(res.status).toBe(404);
    });

    it('should successfully delete an item', async () => {
      const { db } = await import('@workspace/db');
      vi.mocked((db as any).returning).mockResolvedValueOnce([{ id: 1 }] as any);

      const res = await request(app).delete('/api/history/1');
      expect(res.status).toBe(204);
    });
  });

  describe('GET /api/share/:share_id', () => {
    it('should return 404 for invalid share id', async () => {
      const { db } = await import('@workspace/db');
      vi.mocked((db as any).query.queryHistoryTable.findFirst).mockResolvedValueOnce(undefined);

      const res = await request(app).get('/api/share/invalid123');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });

    it('should return shared item', async () => {
      const { db } = await import('@workspace/db');
      vi.mocked((db as any).query.queryHistoryTable.findFirst).mockResolvedValueOnce({
        id: 1, 
        originalQuery: 'SELECT *', 
        optimizedQuery: 'SELECT *',
        explanation: 'exp',
        dbType: 'postgresql', 
        suggestedIndexes: [], 
        bottlenecks: [],
        estimatedImprovement: '10%',
        executionPlanSummary: 'fast',
        queryComplexityScore: 1,
        createdAt: new Date(),
        userId: 'test_user_id',
        shareId: 'valid123'
      } as any);

      const res = await request(app).get('/api/share/valid123');
      if (res.status === 500) console.error('SHARE 500 ERROR:', res.body);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('share_id', 'valid123');
    });
  });

  describe('POST /api/share', () => {
    it('should generate a new share link if none exists', async () => {
      const { db } = await import('@workspace/db');
      // Mock finding the history item (db.where resolves for finding)
      vi.mocked((db as any).query.queryHistoryTable.findFirst).mockResolvedValueOnce({ id: 1, userId: 'test_user_id', shareId: null } as any);
      // Mock the update operation (which uses returning)
      vi.mocked((db as any).returning).mockResolvedValueOnce([{ id: 1, shareId: 'newshare123' }] as any);

      const res = await request(app).post('/api/share').send({ history_id: 1 });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('share_id');
    });
  });
});
