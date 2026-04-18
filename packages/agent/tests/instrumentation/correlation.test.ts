import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  runWithContext,
  getCurrentContext,
  createRequestContext,
} from "../../src/instrumentation/correlation.ts";

describe("Correlation IDs", () => {
  test("context is available inside the callback", () => {
    const ctx = createRequestContext("GET", "/users");
    let seen: ReturnType<typeof getCurrentContext>;

    runWithContext(ctx, () => {
      seen = getCurrentContext();
    });

    assert.ok(seen, "context should be available inside runWithContext");
    assert.equal(seen!.method, "GET");
    assert.equal(seen!.url, "/users");
  });

  test("context is available inside async callbacks nested 5 levels deep", async () => {
    const ctx = createRequestContext("POST", "/api/data");
    let deepContext: ReturnType<typeof getCurrentContext>;

    await runWithContext(ctx, async () => {
      await Promise.resolve();
      await new Promise<void>((resolve) => {
        setImmediate(() => {
          setImmediate(() => {
            setImmediate(() => {
              deepContext = getCurrentContext();
              resolve();
            });
          });
        });
      });
    });

    assert.ok(deepContext!, "context should propagate through 5 levels of async nesting");
    assert.equal(deepContext!.method, "POST");
    assert.equal(deepContext!.url, "/api/data");
  });

  test("context is isolated between concurrent requests", async () => {
    const ctx1 = createRequestContext("GET", "/users");
    const ctx2 = createRequestContext("POST", "/orders");
    const results: { url: string | undefined; requestId: string }[] = [];

    await Promise.all([
      runWithContext(ctx1, async () => {
        await new Promise<void>((r) => setTimeout(r, 10));
        const c = getCurrentContext();
        if (c) results.push({ url: c.url, requestId: c.requestId });
      }),
      runWithContext(ctx2, async () => {
        await new Promise<void>((r) => setTimeout(r, 5));
        const c = getCurrentContext();
        if (c) results.push({ url: c.url, requestId: c.requestId });
      }),
    ]);

    assert.equal(results.length, 2);
    const urls = results.map((r) => r.url).sort();
    assert.deepEqual(urls, ["/orders", "/users"]);
    // Verify request IDs are distinct
    assert.notEqual(results[0].requestId, results[1].requestId);
  });

  test("getCurrentContext returns undefined outside a request context", () => {
    const result = getCurrentContext();
    assert.equal(result, undefined);
  });

  test("createRequestContext generates a unique requestId", () => {
    const ctx1 = createRequestContext();
    const ctx2 = createRequestContext();
    assert.ok(ctx1.requestId, "requestId should be set");
    assert.ok(ctx2.requestId, "requestId should be set");
    assert.notEqual(ctx1.requestId, ctx2.requestId, "each context should have a unique requestId");
  });

  test("createRequestContext captures startedAt as approximate current time", () => {
    const before = Date.now();
    const ctx = createRequestContext();
    const after = Date.now();
    assert.ok(
      ctx.startedAt >= before && ctx.startedAt <= after,
      "startedAt should be current time",
    );
  });

  test("context does not bleed out after runWithContext completes", () => {
    const ctx = createRequestContext();
    runWithContext(ctx, () => {
      /* no-op */
    });
    const leaked = getCurrentContext();
    assert.equal(
      leaked,
      undefined,
      "context should not be accessible after runWithContext completes",
    );
  });
});
