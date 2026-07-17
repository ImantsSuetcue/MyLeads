// The actual "Rollen & Rechte" access-control mechanism: which target profiles
// ("Listen/Boards") a user may see. Managers and Platform-Admins are never
// restricted. Members are restricted to profiles granted to them directly OR
// to a group they belong to (list_permissions.group_id) — because that check
// joins live through group_members, a group grant automatically covers every
// current AND future member of that group, with no extra bookkeeping needed
// when someone joins later.
const db = require('../db/db');

function canAccessProfile({ userId, role, targetProfileId }) {
  if (role !== 'member') return true;

  const row = db
    .prepare(
      `SELECT 1 FROM list_permissions lp
       WHERE lp.target_profile_id = ?
         AND (lp.user_id = ? OR lp.group_id IN (SELECT group_id FROM group_members WHERE user_id = ?))
       LIMIT 1`
    )
    .get(targetProfileId, userId, userId);

  return Boolean(row);
}

// SQL fragment for filtering a LIST of profiles/leads by accessible target_profile_id
// when the caller is a member. `profileIdColumn` is the column holding the target
// profile id in the outer query (e.g. "tp.id" or "l.target_profile_id"). Bind
// userId twice (matches the two "?" placeholders) only when role === 'member'.
function memberAccessClause(profileIdColumn) {
  return `${profileIdColumn} IN (
    SELECT lp.target_profile_id FROM list_permissions lp
    WHERE lp.user_id = ? OR lp.group_id IN (SELECT group_id FROM group_members WHERE user_id = ?)
  )`;
}

module.exports = { canAccessProfile, memberAccessClause };
