import { createRequire } from 'node:module';
import { isAlreadyPatched, wrapMethod } from './patch-utils.ts';

/**
 * AWS SDK v3 uses a command-based `.send()` pattern.
 * We patch `DynamoDBClient.prototype.send` to intercept all commands
 * (GetItem, PutItem, Query, Scan, etc.).
 */
export function patchDynamodb(): boolean {
  const require = createRequire(import.meta.url);
  try {
    const dynamodb = require('@aws-sdk/client-dynamodb');
    const proto = dynamodb.DynamoDBClient?.prototype;
    if (proto?.send && !isAlreadyPatched(proto, 'send')) {
      wrapMethod(proto, 'send', '@aws-sdk/client-dynamodb');
      return true;
    }
  } catch { /* not installed */ }

  // Also try the document client
  try {
    const docClient = require('@aws-sdk/lib-dynamodb');
    const proto = docClient.DynamoDBDocumentClient?.prototype;
    if (proto?.send && !isAlreadyPatched(proto, 'send')) {
      wrapMethod(proto, 'send', '@aws-sdk/lib-dynamodb');
      return true;
    }
  } catch { /* not installed */ }

  return false;
}
