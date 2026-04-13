import { nodeRequire } from './_require.ts';
import { isAlreadyPatched, wrapMethod } from './patch-utils.ts';

export function patchBigquery(): boolean {
  try {
    const bq = nodeRequire('@google-cloud/bigquery');
    const bqProto = bq.BigQuery?.prototype;
    if (!bqProto) return false;

    let patched = false;
    if (bqProto.query && !isAlreadyPatched(bqProto, 'query')) {
      wrapMethod(bqProto, 'query', '@google-cloud/bigquery');
      patched = true;
    }
    if (bqProto.createQueryJob && !isAlreadyPatched(bqProto, 'createQueryJob')) {
      wrapMethod(bqProto, 'createQueryJob', '@google-cloud/bigquery');
      patched = true;
    }
    return patched;
  } catch { /* not installed */ }
  return false;
}
