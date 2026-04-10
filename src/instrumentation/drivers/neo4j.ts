import { createRequire } from 'node:module';
import { isAlreadyPatched, wrapMethod } from './patch-utils.ts';

/**
 * Neo4j graph database uses `Session.prototype.run` for Cypher query execution.
 */
export function patchNeo4j(): boolean {
  const require = createRequire(import.meta.url);
  try {
    const neo4j = require('neo4j-driver');

    // neo4j-driver exports the Session class via internal modules
    // The safest approach is to patch via a temporary session's prototype
    const driver = neo4j.driver?.('bolt://localhost');
    if (driver) {
      const session = driver.session?.();
      if (session) {
        const sessionProto = Object.getPrototypeOf(session);
        if (sessionProto.run && !isAlreadyPatched(sessionProto, 'run')) {
          wrapMethod(sessionProto, 'run', 'neo4j-driver');
          session.close?.().catch?.(() => {});
          driver.close?.().catch?.(() => {});
          return true;
        }
        session.close?.().catch?.(() => {});
      }
      driver.close?.().catch?.(() => {});
    }
  } catch { /* not installed */ }
  return false;
}
