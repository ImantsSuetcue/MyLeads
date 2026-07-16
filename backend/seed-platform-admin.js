// One-off script: creates the first Platform-Admin login from .env values.
// Platform-Admins are never self-registered (see spec) — this script (or an
// existing Platform-Admin, in a later phase) is the only way to create one.
// Usage: npm run seed:admin
const db = require('./src/db/db');
const env = require('./src/config/env');
const { newId } = require('./src/utils/ids');
const { hashPassword } = require('./src/utils/passwords');

async function main() {
  if (!env.PLATFORM_ADMIN_EMAIL || !env.PLATFORM_ADMIN_PASSWORD) {
    console.error('Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD in .env first.');
    process.exit(1);
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(env.PLATFORM_ADMIN_EMAIL);
  if (existing) {
    console.log(`Platform-Admin ${env.PLATFORM_ADMIN_EMAIL} already exists.`);
    return;
  }

  const passwordHash = await hashPassword(env.PLATFORM_ADMIN_PASSWORD);
  db.prepare(
    `INSERT INTO users (id, organization_id, email, password_hash, role, full_name)
     VALUES (?, NULL, ?, ?, 'platform_admin', 'Platform Admin')`
  ).run(newId(), env.PLATFORM_ADMIN_EMAIL, passwordHash);

  console.log(`Platform-Admin created: ${env.PLATFORM_ADMIN_EMAIL}`);
}

main();
