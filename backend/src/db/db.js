// Single shared SQLite connection using Node's built-in node:sqlite module
// (no native dependency to install/compile). Synchronous API on purpose:
// keeps route handlers simple to read for someone new to Node.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const env = require('../config/env');

fs.mkdirSync(path.dirname(env.DB_FILE), { recursive: true });

const db = new DatabaseSync(env.DB_FILE);
db.exec('PRAGMA foreign_keys = ON;');

module.exports = db;
