import { randomBytes } from 'node:crypto';

export function createSessionStore({ ttlMs }) {
  const sessions = new Map();
  const byNameId = new Map();

  function destroy(sid) {
    const record = sessions.get(sid);
    if (!record) return false;
    sessions.delete(sid);
    const sids = byNameId.get(record.user.nameId);
    if (sids) {
      sids.delete(sid);
      if (sids.size === 0) byNameId.delete(record.user.nameId);
    }
    return true;
  }

  return {
    create(user) {
      const sid = randomBytes(32).toString('hex');
      sessions.set(sid, { user, expiresAt: Date.now() + ttlMs });
      if (user.nameId) {
        if (!byNameId.has(user.nameId)) byNameId.set(user.nameId, new Set());
        byNameId.get(user.nameId).add(sid);
      }
      return sid;
    },

    get(sid) {
      const record = sessions.get(sid);
      if (!record) return null;
      if (record.expiresAt <= Date.now()) {
        destroy(sid);
        return null;
      }
      return record.user;
    },

    destroy,

    // IdP logout arrives as a cross-site POST. SameSite=Lax will not attach
    // our cookie to that POST, so the NameID in the signed LogoutRequest is
    // how we find the session.
    destroyByNameId(nameId) {
      const sids = byNameId.get(nameId);
      if (!sids) return 0;
      let count = 0;
      for (const sid of [...sids]) {
        if (destroy(sid)) count += 1;
      }
      return count;
    },
  };
}
