// Run with `npm run migrate`. Safe to run repeatedly (CREATE TABLE IF NOT EXISTS).
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

db.exec(schema);

// Patches for databases created before a column existed (SQLite has no
// "ADD COLUMN IF NOT EXISTS", so check first). New tables in schema.sql are
// already safe via CREATE TABLE IF NOT EXISTS — this is only for columns
// added to tables that may already exist on someone's machine.
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Migrated: added ${table}.${column}`);
  }
}

addColumnIfMissing('leads', 'industry_size_source', 'TEXT');
addColumnIfMissing('leads', 'value_proposition', 'TEXT');
addColumnIfMissing('lead_reports', 'value_proposition', 'TEXT');

console.log('Migration complete. Tables:');
const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
for (const row of rows) {
  console.log(' -', row.name);
}
