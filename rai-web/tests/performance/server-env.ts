import path from 'node:path';
import { guardLaunch, type LaunchConfig } from './server-contract.js';
/** Exact bounded environment passed to built startup; no inherited runtime defaults. */
export function serverEnv(config: LaunchConfig, root: string): Record<string, string> {
  guardLaunch(config);
  const target = config[config.target];
  return {
    UPLOAD_MAX_FILE_BYTES: '26214400',
    UPLOAD_MAX_PACK_BYTES: '157286400',
    UPLOAD_MAX_IMAGE_PIXELS: '40000000',
    IDEMPOTENCY_TTL_HOURS: '72',
    BLOB_ORPHAN_MIN_AGE_HOURS: '24',
    BLOB_TMP_MAX_AGE_HOURS: '1',
    NODE_ENV: 'test',
    RAI_IDENTITY_MODE: 'fixture',
    HOST: '127.0.0.1',
    PORT: new URL(target.baseUrl).port,
    PUBLIC_BASE_URL: new URL(target.baseUrl).origin,
    DATABASE_URL: target.urls.app,
    DATABASE_MIGRATE_URL: target.urls.owner,
    DATABASE_OPERATOR_URL: target.urls.operator,
    BLOB_DIR: path.join(root, 'blobs'),
    MAIL_SINK_DIR: path.join(root, 'mail'),
    MAIL_MODE: 'sink-file',
    QC_MODE: 'substitute',
    BUILD_COMMIT: target.finalHead,
    TRUST_PROXY: 'false',
    LOG_PRETTY: 'false',
    LOG_LEVEL: 'info',
  };
}
