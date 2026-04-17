/**
 * Driver integration tests using synthetic prototype mocks.
 *
 * These tests validate the full driver instrumentation pipeline
 * (isAlreadyPatched guard → wrapMethod → diagnostics_channel publish)
 * without requiring any actual npm database packages to be installed.
 *
 * This covers the previously-uncoverable "happy path" branches in each driver,
 * verifying that the wrapMethod integration works correctly for all calling
 * conventions (promise-style, callback-style, synchronous).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import diagnostics_channel from 'node:diagnostics_channel';
import {
  wrapMethod,
  patchMethod,
  isAlreadyPatched,
  activePatches,
  AUTO_PATCH_CHANNEL,
  PATCHED_SYMBOL,
  type PatchedQueryMessage,
} from '../../src/instrumentation/drivers/patch-utils.ts';

// ── Shared cleanup ─────────────────────────────────────────────────────────
afterEach(() => {
  while (activePatches.length > 0) {
    const p = activePatches.pop()!;
    p.target[p.methodName] = p.original;
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────
function collectMessages(fn: () => void | Promise<void>): Promise<PatchedQueryMessage[]> {
  return new Promise(async (resolve) => {
    const ch = diagnostics_channel.channel(AUTO_PATCH_CHANNEL);
    const messages: PatchedQueryMessage[] = [];
    const listener = (msg: PatchedQueryMessage) => messages.push(msg);
    ch.subscribe(listener);
    try {
      await fn();
    } finally {
      ch.unsubscribe(listener);
    }
    resolve(messages);
  });
}

// ────────────────────────────────────────────────────────────────────────────
describe('Driver instrumentation (mock-based)', () => {

  // ── Simulated pg-style: Promise-based query ──────────────────────────────
  describe('pg-style (Promise query)', () => {
    it('should patch Client.prototype.query and publish to channel', async () => {
      const mockPgProto = {
        query: async (_sql: string) => ({ rows: [{ id: 1 }] }),
      };

      // Simulate what patchPg() does after require('pg') succeeds
      if (!isAlreadyPatched(mockPgProto, 'query')) {
        wrapMethod(mockPgProto, 'query', 'pg');
      }

      assert.ok(isAlreadyPatched(mockPgProto, 'query'), 'Should be marked as patched');

      const messages = await collectMessages(async () => {
        const result = await mockPgProto.query('SELECT id FROM users WHERE id = $1');
        assert.deepStrictEqual(result, { rows: [{ id: 1 }] });
      });

      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].driver, 'pg');
      assert.strictEqual(messages[0].query, 'SELECT id FROM users WHERE id = $1');
      assert.ok(typeof messages[0].durationMs === 'number');
      assert.ok(!messages[0].error, 'No error expected');
    });

    it('should publish error to channel when pg query rejects', async () => {
      const mockPgProto = {
        query: async (_sql: string) => { throw new Error('connection refused'); },
      };
      wrapMethod(mockPgProto, 'query', 'pg');

      const messages = await collectMessages(async () => {
        await assert.rejects(() => mockPgProto.query('SELECT 1'), /connection refused/);
      });

      assert.strictEqual(messages.length, 1);
      assert.ok(messages[0].error instanceof Error);
    });

    it('should not patch twice (isAlreadyPatched guard)', () => {
      const mockPgProto = { query: async (_sql: string) => 'ok' };
      wrapMethod(mockPgProto, 'query', 'pg');
      const wrappedRef = mockPgProto.query;
      const sizeBefore = activePatches.length;

      // Second call (simulating applyDriverPatches called twice)
      if (!isAlreadyPatched(mockPgProto, 'query')) {
        wrapMethod(mockPgProto, 'query', 'pg');
      }

      assert.strictEqual(mockPgProto.query, wrappedRef, 'Should not re-wrap');
      assert.strictEqual(activePatches.length, sizeBefore, 'Should not add duplicate patch');
    });
  });

  // ── Simulated mysql2-style: Connection with query + execute ───────────────
  describe('mysql2-style (Connection prototype)', () => {
    it('should patch both query and execute', async () => {
      const mockMysql2Proto = {
        query: async (_sql: string) => [{ id: 1 }],
        execute: async (_sql: string) => [{ id: 2 }],
      };

      // Simulate what patchMysql() does
      let patched = false;
      if (!isAlreadyPatched(mockMysql2Proto, 'query')) {
        wrapMethod(mockMysql2Proto, 'query', 'mysql2');
        patched = true;
      }
      if (!isAlreadyPatched(mockMysql2Proto, 'execute')) {
        wrapMethod(mockMysql2Proto, 'execute', 'mysql2');
        patched = true;
      }

      assert.ok(patched, 'Should have patched at least one method');
      assert.ok(isAlreadyPatched(mockMysql2Proto, 'query'));
      assert.ok(isAlreadyPatched(mockMysql2Proto, 'execute'));

      const queryMessages = await collectMessages(async () => {
        await mockMysql2Proto.query('SELECT * FROM orders');
      });
      assert.strictEqual(queryMessages[0].driver, 'mysql2');

      const execMessages = await collectMessages(async () => {
        await mockMysql2Proto.execute('INSERT INTO t VALUES (?)');
      });
      assert.strictEqual(execMessages[0].driver, 'mysql2');
    });
  });

  // ── Simulated MongoDB-style: callback-based ────────────────────────────────
  describe('mongodb-style (callback query)', () => {
    it('should patch callback-style find and publish timing', async () => {
      const mockMongoProto = {
        find: (query: any, cb: Function) => {
          setImmediate(() => cb(null, [{ _id: 1 }]));
        }
      };

      wrapMethod(mockMongoProto, 'find', 'mongodb');
      assert.ok(isAlreadyPatched(mockMongoProto, 'find'));

      const messages = await collectMessages(() => new Promise<void>(resolve => {
        mockMongoProto.find({ name: 'test' }, (err: any, docs: any[]) => {
          assert.strictEqual(err, null);
          assert.ok(Array.isArray(docs));
          resolve();
        });
      }));

      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].driver, 'mongodb');
      assert.ok(typeof messages[0].durationMs === 'number');
    });

    it('should publish callback error to channel', async () => {
      const mockMongoProto = {
        insertOne: (doc: any, cb: Function) => {
          setImmediate(() => cb(new Error('write concern failed'), null));
        }
      };

      wrapMethod(mockMongoProto, 'insertOne', 'mongodb');

      const messages = await collectMessages(() => new Promise<void>(resolve => {
        mockMongoProto.insertOne({ name: 'test' }, (_err: any) => {
          // error from DB — expected
          resolve();
        });
      }));

      assert.strictEqual(messages.length, 1);
      assert.ok(messages[0].error instanceof Error, 'Should forward callback error to channel');
    });
  });

  // ── Simulated Redis-style: synchronous return ─────────────────────────────
  describe('redis-style (synchronous)', () => {
    it('should patch synchronous get and publish timing', async () => {
      const mockRedisProto = {
        get: (_key: string) => 'cached-value',
      };

      wrapMethod(mockRedisProto, 'get', 'redis');
      assert.ok(isAlreadyPatched(mockRedisProto, 'get'));

      const messages = await collectMessages(() => {
        const result = mockRedisProto.get('user:1');
        assert.strictEqual(result, 'cached-value');
      });

      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].driver, 'redis');
    });
  });

  // ── Object-style query arg (e.g. pg { text, values }) ────────────────────
  describe('object query arg (text property)', () => {
    it('should extract query text from .text property', async () => {
      const mockProto = {
        query: async (_cfg: any) => ({ rows: [] }),
      };
      wrapMethod(mockProto, 'query', 'pg');

      const messages = await collectMessages(async () => {
        await mockProto.query({ text: 'SELECT $1', values: [42] } as any);
      });

      assert.strictEqual(messages[0].query, 'SELECT $1');
    });
  });

  // ── patchMethod public utility ────────────────────────────────────────────
  describe('patchMethod public utility', () => {
    it('should wrap and track a custom user-defined driver method', async () => {
      const customDriver = {
        executeQuery: async (_sql: string) => ({ affected: 1 }),
      };

      patchMethod(customDriver, 'executeQuery', 'custom-db');
      assert.ok(isAlreadyPatched(customDriver, 'executeQuery'));

      const messages = await collectMessages(async () => {
        await customDriver.executeQuery('UPDATE users SET active = TRUE');
      });

      assert.strictEqual(messages[0].query, 'UPDATE users SET active = TRUE');
      assert.strictEqual(messages[0].driver, 'custom-db');
    });

    it('PATCHED_SYMBOL should be set on wrapped function', () => {
      const proto = { run: (_q: string) => true };
      patchMethod(proto, 'run', 'sqlite');
      assert.strictEqual((proto.run as any)[PATCHED_SYMBOL], true);
    });
  });
});
