// Run with `npm run migrate`. Safe to run repeatedly (CREATE TABLE IF NOT EXISTS).
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

db.exec(schema);

// Patch databases created before industry_size_source existed (SQLite has no
// "ADD COLUMN IF NOT EXISTS", so check first). New tables above are already
// safe via CREATE TABLE IF NOT EXISTS.
const leadsColumns = db.prepare('PRAGMA table_info(leads)').all().map((c) => c.name);
if (!leadsColumns.includes('industry_size_source')) {
  db.exec('ALTER TABLE leads ADD COLUMN industry_size_source TEXT');
  console.log('Migrated: added leads.industry_size_source');
}

console.log('Migration complete. Tables:');
const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
for (const row of rows) {
  console.log(' -', row.name);
}
