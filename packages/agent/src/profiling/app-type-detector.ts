import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppType } from "../argus-agent.ts";

/**
 * Known package fingerprints mapped to each app type.
 *
 * When any dependency from a group is found in `package.json`,
 * the corresponding `AppType` is included in the detection result.
 */
const WEB_PACKAGES = new Set([
  // Frameworks
  "express",
  "fastify",
  "koa",
  "@hapi/hapi",
  "hapi",
  "@nestjs/core",
  "@nestjs/platform-express",
  "@nestjs/platform-fastify",
  "next",
  "nuxt",
  "remix",
  "astro",
  // HTTP utilities
  "body-parser",
  "cors",
  "helmet",
  "express-session",
  "socket.io",
  "ws",
  // GraphQL servers
  "apollo-server",
  "@apollo/server",
  "graphql-yoga",
  "mercurius",
]);

const DB_PACKAGES = new Set([
  // PostgreSQL
  "pg",
  "pg-promise",
  // MySQL
  "mysql",
  "mysql2",
  // MongoDB
  "mongodb",
  "mongoose",
  // ORMs / Query Builders
  "sequelize",
  "typeorm",
  "@prisma/client",
  "knex",
  "objection",
  "drizzle-orm",
  "mikro-orm",
  // Redis
  "redis",
  "ioredis",
  // Other
  "mssql",
  "tedious",
  "oracledb",
  "better-sqlite3",
  "sqlite3",
  "@google-cloud/bigquery",
  "@elastic/elasticsearch",
  "cassandra-driver",
  "neo4j-driver",
  "couchbase",
]);

const WORKER_PACKAGES = new Set([
  // Job queues
  "bull",
  "bullmq",
  "agenda",
  "bee-queue",
  "pg-boss",
  // Scheduling
  "node-cron",
  "cron",
  "node-schedule",
  // Message brokers
  "amqplib",
  "kafkajs",
  "@google-cloud/pubsub",
  "nats",
  // Workers / Clustering
  "workerpool",
  "piscina",
  "threads",
]);

export interface DetectionResult {
  /** The detected app types (empty array = nothing recognized). */
  types: AppType[];
  /** Which packages triggered each type — useful for logging / debugging. */
  matches: Record<AppType, string[]>;
}

/**
 * Scans the nearest `package.json` (dependencies + devDependencies)
 * and returns the detected app types based on known package fingerprints.
 *
 * @param baseDir  Directory to look for `package.json` (defaults to `process.cwd()`).
 * @returns        Detected app types and the packages that triggered them.
 */
export function detectAppTypes(baseDir: string = process.cwd()): DetectionResult {
  const pkgPath = resolve(baseDir, "package.json");

  let deps: string[];
  try {
    const raw = readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  } catch {
    // No package.json or unreadable — return empty
    return { types: [], matches: { web: [], db: [], worker: [] } };
  }

  const matches: Record<AppType, string[]> = { web: [], db: [], worker: [] };

  for (const dep of deps) {
    if (WEB_PACKAGES.has(dep)) matches.web.push(dep);
    if (DB_PACKAGES.has(dep)) matches.db.push(dep);
    if (WORKER_PACKAGES.has(dep)) matches.worker.push(dep);
  }

  const types: AppType[] = [];
  if (matches.web.length > 0) types.push("web");
  if (matches.db.length > 0) types.push("db");
  if (matches.worker.length > 0) types.push("worker");

  return { types, matches };
}
