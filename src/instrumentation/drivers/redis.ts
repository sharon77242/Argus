import { createRequire } from 'node:module';
import { isAlreadyPatched, wrapMethod } from './patch-utils.ts';

export function patchIoredis(): boolean {
  const require = createRequire(import.meta.url);
  try {
    const IORedis = require('ioredis');
    if (IORedis?.prototype?.sendCommand && !isAlreadyPatched(IORedis.prototype, 'sendCommand')) {
      wrapMethod(IORedis.prototype, 'sendCommand', 'ioredis');
      return true;
    }
  } catch { /* not installed */ }
  return false;
}

export function patchNodeRedis(): boolean {
  const require = createRequire(import.meta.url);
  try {
    const redis = require('redis');
    const clientProto = redis.RedisClient?.prototype ?? redis.createClient?.()?.constructor?.prototype;
    if (clientProto?.sendCommand && !isAlreadyPatched(clientProto, 'sendCommand')) {
      wrapMethod(clientProto, 'sendCommand', 'redis');
      return true;
    }
  } catch { /* not installed */ }
  return false;
}
