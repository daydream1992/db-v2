// DataOps 管理台 — 共享配置
// 所有路径、端口、仓库名统一从此处导出，便于环境变量覆盖
// 版本号同步 package.json

import pkg from '@/../package.json'

export const APP_CONFIG = {
  dbName: 'profit_radar.duckdb',
  dbPath: process.env.NEXT_PUBLIC_DB_PATH || 'db/profit_radar.duckdb',
  backupDir: process.env.NEXT_PUBLIC_BACKUP_DIR || './archive',
  projectRoot: process.env.NEXT_PUBLIC_PROJECT_ROOT || '.',
  logStreamerPort: process.env.NEXT_PUBLIC_LOG_STREAMER_PORT || '3003',
  gitHubRepo: process.env.NEXT_PUBLIC_GITHUB_REPO || 'https://github.com/daydream1992/db-v2',
  gitHubBranch: process.env.NEXT_PUBLIC_GITHUB_BRANCH || 'master',
  gitHubToken: process.env.GITHUB_TOKEN || '',
  projectName: 'DB数据库_v2',
  version: pkg.version || '0.2.0',
} as const
