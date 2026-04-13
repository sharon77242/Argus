/**
 * Coverage tests for all individual driver patch modules.
 * Mocks nodeRequire to simulate installed drivers without real dependencies.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { activePatches } from '../../src/instrumentation/drivers/patch-utils.ts';
import { requireRef } from '../../src/instrumentation/drivers/_require.ts';

// Helper to remove all active patches
function cleanupPatches() {
  while (activePatches.length > 0) {
    const p = activePatches.pop()!;
    p.target[p.methodName] = p.original;
  }
}

// Helper: replace nodeRequire temporarily via the mutable requireRef
function mockNodeRequire(fake: (mod: string) => any) {
  const original = requireRef.current;
  requireRef.current = fake as unknown as NodeRequire;
  return () => { requireRef.current = original; };
}

describe('Driver Patch Modules (coverage)', () => {

  afterEach(() => {
    // Clean up all patches after each test
    while (activePatches.length > 0) {
      const p = activePatches.pop()!;
      p.target[p.methodName] = p.original;
    }
  });

  // ── pg.ts ──────────────────────────────────────────────────────
  describe('patchPg', () => {
    it('should patch pg Client.prototype.query when available', async () => {
      const { patchPg } = await import('../../src/instrumentation/drivers/pg.ts');
      const mockProto = { query: async (_sql: string) => ({ rows: [] }) };
      const restore = mockNodeRequire(() => ({ Client: { prototype: mockProto } }));
      try {
        const result = patchPg();
        assert.strictEqual(result, true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should return false when pg is not installed', async () => {
      const { patchPg } = await import('../../src/instrumentation/drivers/pg.ts');
      const restore = mockNodeRequire(() => { throw new Error('not found'); });
      try {
        assert.strictEqual(patchPg(), false);
      } finally { restore(); }
    });

    it('should return false when Client.prototype.query is missing', async () => {
      const { patchPg } = await import('../../src/instrumentation/drivers/pg.ts');
      const restore = mockNodeRequire(() => ({ Client: { prototype: {} } }));
      try {
        assert.strictEqual(patchPg(), false);
      } finally { restore(); }
    });
  });

  // ── mysql.ts ───────────────────────────────────────────────────
  describe('patchMysql', () => {
    it('should patch mysql2 Connection.prototype.query and execute', async () => {
      const { patchMysql } = await import('../../src/instrumentation/drivers/mysql.ts');
      const mockProto = {
        query: async (_sql: string) => [{ id: 1 }],
        execute: async (_sql: string) => [{ id: 2 }],
      };
      const restore = mockNodeRequire(() => ({ Connection: { prototype: mockProto } }));
      try {
        assert.strictEqual(patchMysql(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should return false when mysql2 is not installed', async () => {
      const { patchMysql } = await import('../../src/instrumentation/drivers/mysql.ts');
      const restore = mockNodeRequire(() => { throw new Error('not found'); });
      try {
        assert.strictEqual(patchMysql(), false);
      } finally { restore(); }
    });

    it('should return false when Connection prototype has no methods', async () => {
      const { patchMysql } = await import('../../src/instrumentation/drivers/mysql.ts');
      const restore = mockNodeRequire(() => ({ Connection: { prototype: {} } }));
      try {
        assert.strictEqual(patchMysql(), false);
      } finally { restore(); }
    });
  });

  // ── mongodb.ts ─────────────────────────────────────────────────
  describe('patchMongodb', () => {
    it('should patch mongodb Collection prototype methods', async () => {
      const { patchMongodb } = await import('../../src/instrumentation/drivers/mongodb.ts');
      const mockProto: Record<string, any> = {};
      for (const m of ['find', 'findOne', 'insertOne', 'insertMany', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'aggregate']) {
        mockProto[m] = async () => ({});
      }
      const restore = mockNodeRequire(() => ({ Collection: { prototype: mockProto } }));
      try {
        assert.strictEqual(patchMongodb(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should return false when Collection.prototype is missing', async () => {
      const { patchMongodb } = await import('../../src/instrumentation/drivers/mongodb.ts');
      const restore = mockNodeRequire(() => ({ Collection: {} }));
      try {
        assert.strictEqual(patchMongodb(), false);
      } finally { restore(); }
    });

    it('should return false when not installed', async () => {
      const { patchMongodb } = await import('../../src/instrumentation/drivers/mongodb.ts');
      const restore = mockNodeRequire(() => { throw new Error('not found'); });
      try {
        assert.strictEqual(patchMongodb(), false);
      } finally { restore(); }
    });
  });

  // ── redis.ts (ioredis + node-redis) ────────────────────────────
  describe('patchIoredis', () => {
    it('should patch ioredis prototype.sendCommand', async () => {
      const { patchIoredis } = await import('../../src/instrumentation/drivers/redis.ts');
      const mockClass = function IORedis() {} as any;
      mockClass.prototype = { sendCommand: async () => 'OK' };
      const restore = mockNodeRequire(() => mockClass);
      try {
        assert.strictEqual(patchIoredis(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should return false when ioredis is not installed', async () => {
      const { patchIoredis } = await import('../../src/instrumentation/drivers/redis.ts');
      const restore = mockNodeRequire(() => { throw new Error('not found'); });
      try {
        assert.strictEqual(patchIoredis(), false);
      } finally { restore(); }
    });
  });

  describe('patchNodeRedis', () => {
    it('should patch redis RedisClient.prototype.sendCommand', async () => {
      const { patchNodeRedis } = await import('../../src/instrumentation/drivers/redis.ts');
      const mockProto = { sendCommand: async () => 'OK' };
      const restore = mockNodeRequire(() => ({ RedisClient: { prototype: mockProto } }));
      try {
        assert.strictEqual(patchNodeRedis(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should return false when redis is not installed', async () => {
      const { patchNodeRedis } = await import('../../src/instrumentation/drivers/redis.ts');
      const restore = mockNodeRequire(() => { throw new Error('not found'); });
      try {
        assert.strictEqual(patchNodeRedis(), false);
      } finally { restore(); }
    });

    it('should return false when no prototype found', async () => {
      const { patchNodeRedis } = await import('../../src/instrumentation/drivers/redis.ts');
      const restore = mockNodeRequire(() => ({}));
      try {
        assert.strictEqual(patchNodeRedis(), false);
      } finally { restore(); }
    });
  });

  // ── bigquery.ts ────────────────────────────────────────────────
  describe('patchBigquery', () => {
    it('should patch BigQuery prototype methods', async () => {
      const { patchBigquery } = await import('../../src/instrumentation/drivers/bigquery.ts');
      const mockProto = { query: async () => [[]], createQueryJob: async () => ({}) };
      const restore = mockNodeRequire(() => ({ BigQuery: { prototype: mockProto } }));
      try {
        assert.strictEqual(patchBigquery(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should return false when BigQuery.prototype is missing', async () => {
      const { patchBigquery } = await import('../../src/instrumentation/drivers/bigquery.ts');
      const restore = mockNodeRequire(() => ({ BigQuery: {} }));
      try {
        assert.strictEqual(patchBigquery(), false);
      } finally { restore(); }
    });

    it('should return false when not installed', async () => {
      const { patchBigquery } = await import('../../src/instrumentation/drivers/bigquery.ts');
      const restore = mockNodeRequire(() => { throw new Error('not found'); });
      try {
        assert.strictEqual(patchBigquery(), false);
      } finally { restore(); }
    });
  });

  // ── elasticsearch.ts ───────────────────────────────────────────
  describe('patchElasticsearch', () => {
    it('should patch Elasticsearch Client prototype methods', async () => {
      const { patchElasticsearch } = await import('../../src/instrumentation/drivers/elasticsearch.ts');
      const mockProto: Record<string, any> = {};
      for (const m of ['search', 'index', 'bulk', 'delete', 'update', 'get', 'msearch']) {
        mockProto[m] = async () => ({});
      }
      const restore = mockNodeRequire(() => ({ Client: { prototype: mockProto } }));
      try {
        assert.strictEqual(patchElasticsearch(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should return false when Client.prototype is missing', async () => {
      const { patchElasticsearch } = await import('../../src/instrumentation/drivers/elasticsearch.ts');
      const restore = mockNodeRequire(() => ({ Client: {} }));
      try {
        assert.strictEqual(patchElasticsearch(), false);
      } finally { restore(); }
    });

    it('should return false when not installed', async () => {
      const { patchElasticsearch } = await import('../../src/instrumentation/drivers/elasticsearch.ts');
      const restore = mockNodeRequire(() => { throw new Error('not found'); });
      try {
        assert.strictEqual(patchElasticsearch(), false);
      } finally { restore(); }
    });
  });

  // ── mssql.ts ───────────────────────────────────────────────────
  describe('patchMssql', () => {
    it('should patch mssql Request prototype methods', async () => {
      const { patchMssql } = await import('../../src/instrumentation/drivers/mssql.ts');
      const mockProto = { query: async () => ({}), execute: async () => ({}), batch: async () => ({}) };
      const restore = mockNodeRequire((mod: string) => {
        if (mod === 'mssql') return { Request: { prototype: mockProto } };
        throw new Error('not found');
      });
      try {
        assert.strictEqual(patchMssql(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should patch tedious Connection prototype methods', async () => {
      const { patchMssql } = await import('../../src/instrumentation/drivers/mssql.ts');
      const mockProto = { execSql: () => {}, execSqlBatch: () => {} };
      const restore = mockNodeRequire((mod: string) => {
        if (mod === 'tedious') return { Connection: { prototype: mockProto } };
        throw new Error('not found');
      });
      try {
        assert.strictEqual(patchMssql(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should return false when neither is installed', async () => {
      const { patchMssql } = await import('../../src/instrumentation/drivers/mssql.ts');
      const restore = mockNodeRequire(() => { throw new Error('not found'); });
      try {
        assert.strictEqual(patchMssql(), false);
      } finally { restore(); }
    });
  });

  // ── sqlite.ts ──────────────────────────────────────────────────
  describe('patchBetterSqlite3', () => {
    it('should patch better-sqlite3 Database prototype', async () => {
      const { patchBetterSqlite3 } = await import('../../src/instrumentation/drivers/sqlite.ts');
      const mockProto = { exec: (_sql: string) => {}, prepare: (_sql: string) => ({}) };
      const restore = mockNodeRequire(() => ({ prototype: mockProto }));
      try {
        assert.strictEqual(patchBetterSqlite3(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should return false when prototype is missing', async () => {
      const { patchBetterSqlite3 } = await import('../../src/instrumentation/drivers/sqlite.ts');
      const restore = mockNodeRequire(() => ({}));
      try {
        assert.strictEqual(patchBetterSqlite3(), false);
      } finally { restore(); }
    });

    it('should return false when not installed', async () => {
      const { patchBetterSqlite3 } = await import('../../src/instrumentation/drivers/sqlite.ts');
      const restore = mockNodeRequire(() => { throw new Error('not found'); });
      try {
        assert.strictEqual(patchBetterSqlite3(), false);
      } finally { restore(); }
    });
  });

  // ── prisma.ts ──────────────────────────────────────────────────
  describe('patchPrisma', () => {
    it('should patch PrismaClient prototype methods', async () => {
      const { patchPrisma } = await import('../../src/instrumentation/drivers/prisma.ts');
      const mockProto: Record<string, any> = {};
      for (const m of ['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe']) {
        mockProto[m] = async () => ({});
      }
      const restore = mockNodeRequire(() => ({ PrismaClient: { prototype: mockProto } }));
      try {
        assert.strictEqual(patchPrisma(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should return false when PrismaClient.prototype is missing', async () => {
      const { patchPrisma } = await import('../../src/instrumentation/drivers/prisma.ts');
      const restore = mockNodeRequire(() => ({ PrismaClient: {} }));
      try {
        assert.strictEqual(patchPrisma(), false);
      } finally { restore(); }
    });

    it('should return false when not installed', async () => {
      const { patchPrisma } = await import('../../src/instrumentation/drivers/prisma.ts');
      const restore = mockNodeRequire(() => { throw new Error('not found'); });
      try {
        assert.strictEqual(patchPrisma(), false);
      } finally { restore(); }
    });
  });

  // ── dynamodb.ts ────────────────────────────────────────────────
  describe('patchDynamodb', () => {
    it('should patch DynamoDBClient prototype.send', async () => {
      const { patchDynamodb } = await import('../../src/instrumentation/drivers/dynamodb.ts');
      const mockProto = { send: async () => ({}) };
      const restore = mockNodeRequire((mod: string) => {
        if (mod === '@aws-sdk/client-dynamodb') return { DynamoDBClient: { prototype: mockProto } };
        throw new Error('not found');
      });
      try {
        assert.strictEqual(patchDynamodb(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should fall back to DynamoDBDocumentClient', async () => {
      const { patchDynamodb } = await import('../../src/instrumentation/drivers/dynamodb.ts');
      const mockProto = { send: async () => ({}) };
      const restore = mockNodeRequire((mod: string) => {
        if (mod === '@aws-sdk/lib-dynamodb') return { DynamoDBDocumentClient: { prototype: mockProto } };
        throw new Error('not found');
      });
      try {
        assert.strictEqual(patchDynamodb(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should return false when neither is installed', async () => {
      const { patchDynamodb } = await import('../../src/instrumentation/drivers/dynamodb.ts');
      const restore = mockNodeRequire(() => { throw new Error('not found'); });
      try {
        assert.strictEqual(patchDynamodb(), false);
      } finally { restore(); }
    });
  });

  // ── firestore.ts ───────────────────────────────────────────────
  describe('patchFirestore', () => {
    it('should patch Firestore, Collection, and Document prototypes', async () => {
      const { patchFirestore } = await import('../../src/instrumentation/drivers/firestore.ts');
      const fsProto: Record<string, any> = { getAll: async () => [], runTransaction: async () => ({}) };
      const collProto: Record<string, any> = { add: async () => ({}), get: async () => ({}) };
      const docProto: Record<string, any> = {};
      for (const m of ['get', 'set', 'update', 'delete', 'create']) docProto[m] = async () => ({});

      const restore = mockNodeRequire(() => ({
        Firestore: { prototype: fsProto },
        CollectionReference: { prototype: collProto },
        DocumentReference: { prototype: docProto },
      }));
      try {
        assert.strictEqual(patchFirestore(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should return false when not installed', async () => {
      const { patchFirestore } = await import('../../src/instrumentation/drivers/firestore.ts');
      const restore = mockNodeRequire(() => { throw new Error('not found'); });
      try {
        assert.strictEqual(patchFirestore(), false);
      } finally { restore(); }
    });

    it('should handle missing prototypes gracefully', async () => {
      const { patchFirestore } = await import('../../src/instrumentation/drivers/firestore.ts');
      const restore = mockNodeRequire(() => ({}));
      try {
        assert.strictEqual(patchFirestore(), false);
      } finally { restore(); }
    });
  });

  // ── cassandra.ts ───────────────────────────────────────────────
  describe('patchCassandra', () => {
    it('should patch Client prototype methods', async () => {
      const { patchCassandra } = await import('../../src/instrumentation/drivers/cassandra.ts');
      const mockProto: Record<string, any> = { execute: async () => ({}), batch: async () => ({}), eachRow: () => {} };
      const restore = mockNodeRequire(() => ({ Client: { prototype: mockProto } }));
      try {
        assert.strictEqual(patchCassandra(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should return false when Client.prototype is missing', async () => {
      const { patchCassandra } = await import('../../src/instrumentation/drivers/cassandra.ts');
      const restore = mockNodeRequire(() => ({ Client: {} }));
      try {
        assert.strictEqual(patchCassandra(), false);
      } finally { restore(); }
    });

    it('should return false when not installed', async () => {
      const { patchCassandra } = await import('../../src/instrumentation/drivers/cassandra.ts');
      const restore = mockNodeRequire(() => { throw new Error('not found'); });
      try {
        assert.strictEqual(patchCassandra(), false);
      } finally { restore(); }
    });
  });

  // ── neo4j.ts ───────────────────────────────────────────────────
  describe('patchNeo4j', () => {
    it('should patch neo4j session prototype.run', async () => {
      const { patchNeo4j } = await import('../../src/instrumentation/drivers/neo4j.ts');
      class MockSession {
        async run() { return {}; }
        async close() {}
      }
      const session = new MockSession();
      const driver = { session: () => session, close: async () => {} };
      const restore = mockNodeRequire(() => ({ driver: () => driver }));
      try {
        assert.strictEqual(patchNeo4j(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should return false when driver() returns null', async () => {
      const { patchNeo4j } = await import('../../src/instrumentation/drivers/neo4j.ts');
      const restore = mockNodeRequire(() => ({ driver: () => null }));
      try {
        assert.strictEqual(patchNeo4j(), false);
      } finally { restore(); }
    });

    it('should return false when session() returns null', async () => {
      const { patchNeo4j } = await import('../../src/instrumentation/drivers/neo4j.ts');
      const restore = mockNodeRequire(() => ({ driver: () => ({ session: () => null, close: async () => {} }) }));
      try {
        assert.strictEqual(patchNeo4j(), false);
      } finally { restore(); }
    });

    it('should return false when not installed', async () => {
      const { patchNeo4j } = await import('../../src/instrumentation/drivers/neo4j.ts');
      const restore = mockNodeRequire(() => { throw new Error('not found'); });
      try {
        assert.strictEqual(patchNeo4j(), false);
      } finally { restore(); }
    });
  });

  // ── clickhouse.ts ──────────────────────────────────────────────
  describe('patchClickhouse', () => {
    it('should patch clickhouse client prototype methods', async () => {
      const { patchClickhouse } = await import('../../src/instrumentation/drivers/clickhouse.ts');
      // Simulate: createClient() returns an instance whose prototype has the methods
      class MockClient {
        async query() { return {}; }
        async insert() { return {}; }
        async exec() { return {}; }
        async command() { return {}; }
        async close() {}
      }
      const client = new MockClient();
      const restore = mockNodeRequire(() => ({ createClient: () => client }));
      try {
        assert.strictEqual(patchClickhouse(), true);
      } finally { restore(); cleanupPatches(); }
    });

    it('should return false when createClient returns null', async () => {
      const { patchClickhouse } = await import('../../src/instrumentation/drivers/clickhouse.ts');
      const restore = mockNodeRequire(() => ({ createClient: () => null }));
      try {
        assert.strictEqual(patchClickhouse(), false);
      } finally { restore(); }
    });

    it('should return false when not installed', async () => {
      const { patchClickhouse } = await import('../../src/instrumentation/drivers/clickhouse.ts');
      const restore = mockNodeRequire(() => { throw new Error('not found'); });
      try {
        assert.strictEqual(patchClickhouse(), false);
      } finally { restore(); }
    });
  });
});
