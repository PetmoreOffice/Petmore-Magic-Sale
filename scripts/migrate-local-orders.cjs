// This command is deliberately restricted to this project's local PostgreSQL.
// It never connects to the company SQL Server.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const apiDir = path.resolve(__dirname, '../apps/api');
const config = require('dotenv').parse(fs.readFileSync(path.join(apiDir, '.env')));
const target = new URL(config.DATABASE_URL);
if (target.protocol !== 'postgresql:' || target.hostname !== 'localhost' || target.port !== '5432' || target.pathname !== '/petmore_wms') {
  throw new Error('Refusing migration: expected only localhost:5432/petmore_wms PostgreSQL.');
}
console.log('Migration destination: local PostgreSQL localhost:5432/petmore_wms');
const cli = require.resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
  cwd: apiDir, env: { ...process.env, DATABASE_URL: config.DATABASE_URL }, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
