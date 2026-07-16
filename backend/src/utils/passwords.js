// bcryptjs (pure JS, no native compile step) — consistent with node:sqlite choice.
const bcrypt = require('bcryptjs');

const hashPassword = (plain) => bcrypt.hash(plain, 10);
const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

module.exports = { hashPassword, verifyPassword };
