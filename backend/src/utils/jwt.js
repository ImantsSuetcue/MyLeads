const jwt = require('jsonwebtoken');
const env = require('../config/env');

const signToken = (user) =>
  jwt.sign(
    { sub: user.id, organizationId: user.organization_id, role: user.role, email: user.email },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  );

const verifyToken = (token) => jwt.verify(token, env.JWT_SECRET);

module.exports = { signToken, verifyToken };
