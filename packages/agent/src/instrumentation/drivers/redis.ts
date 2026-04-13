import { nodeRequire } from './_require.ts';
import { isAlreadyPatched, wrapMethod } from './patch-utils.ts';

export function patchIoredis(): boolean {
  try {
    const IORedis = nodeRequire('ioredis');
    if (IORedis?.prototype?.sendCommand && !isAlreadyPatched(IORedis.prototype, 'sendCommand')) {
      wrapMethod(IORedis.prototype, 'sendCommand', 'ioredis');
      return true;
    }
  } catch { /* not installed */ }
  return false;
}

export function patchNodeRedis(): boolean {
  try {
    const redis = nodeRequire('redis');
    const clientProto = redis.RedisClient?.prototype ?? redis.createClient?.()?.constructor?.prototype;
    if (clientProto?.sendCommand && !isAlreadyPatched(clientProto, 'sendCommand')) {
      wrapMethod(clientProto, 'sendCommand', 'redis');
      return true;
    }
  } catch { /* not installed */ }
  return false;
}
