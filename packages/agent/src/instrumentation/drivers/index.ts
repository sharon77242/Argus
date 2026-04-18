import { activePatches } from "./patch-utils.ts";
import { patchPg } from "./pg.ts";
import { patchMysql } from "./mysql.ts";
import { patchMongodb } from "./mongodb.ts";
import { patchBigquery } from "./bigquery.ts";
import { patchElasticsearch } from "./elasticsearch.ts";
import { patchIoredis, patchNodeRedis } from "./redis.ts";
import { patchMssql } from "./mssql.ts";
import { patchBetterSqlite3 } from "./sqlite.ts";
import { patchPrisma } from "./prisma.ts";
import { patchDynamodb } from "./dynamodb.ts";
import { patchFirestore } from "./firestore.ts";
import { patchCassandra } from "./cassandra.ts";
import { patchNeo4j } from "./neo4j.ts";
import { patchClickhouse } from "./clickhouse.ts";

// Re-export shared utilities for external consumers
export { AUTO_PATCH_CHANNEL, patchMethod } from "./patch-utils.ts";
export type { PatchedQueryMessage } from "./patch-utils.ts";

/**
 * Attempts to auto-patch all supported DB drivers that are installed.
 * Drivers that are not installed are silently skipped.
 *
 * Supported drivers:
 * - SQL:   pg, mysql2, mssql, tedious, better-sqlite3, @prisma/client
 * - NoSQL: mongodb, @aws-sdk/client-dynamodb, @google-cloud/firestore, cassandra-driver
 * - Search: @elastic/elasticsearch
 * - Cache: ioredis, redis
 * - Cloud: @google-cloud/bigquery
 * - Graph: neo4j-driver
 * - Analytics: @clickhouse/client
 */
export function applyDriverPatches(): string[] {
  const patched: string[] = [];

  // SQL
  if (patchPg()) patched.push("pg");
  if (patchMysql()) patched.push("mysql2");
  if (patchMssql()) patched.push("mssql");
  if (patchBetterSqlite3()) patched.push("better-sqlite3");
  if (patchPrisma()) patched.push("@prisma/client");

  // NoSQL
  if (patchMongodb()) patched.push("mongodb");
  if (patchDynamodb()) patched.push("@aws-sdk/client-dynamodb");
  if (patchFirestore()) patched.push("@google-cloud/firestore");
  if (patchCassandra()) patched.push("cassandra-driver");

  // Search & Cache
  if (patchElasticsearch()) patched.push("@elastic/elasticsearch");
  if (patchIoredis()) patched.push("ioredis");
  if (patchNodeRedis()) patched.push("redis");

  // Cloud & Analytics
  if (patchBigquery()) patched.push("@google-cloud/bigquery");
  if (patchNeo4j()) patched.push("neo4j-driver");
  if (patchClickhouse()) patched.push("@clickhouse/client");

  return patched;
}

/**
 * Removes all active patches, restoring original prototype methods.
 */
export function removeDriverPatches(): void {
  for (const { target, methodName, original } of activePatches) {
    target[methodName] = original;
  }
  activePatches.length = 0;
}
