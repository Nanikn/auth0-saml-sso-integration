/**
 * Remembers assertion IDs until the assertion itself is dead.
 *
 * node-saml already consumes InResponseTo for SP-initiated logins. IdP-initiated
 * responses have no InResponseTo, so a captured POST could be replayed until
 * NotOnOrAfter. The assertion ID is the identifier that exists on both flows.
 *
 * consume() is synchronous on purpose. A check-then-set with an await in
 * between would let two in-flight copies of the same POST both pass.
 */
export class ReplayCache {
  constructor() {
    this.seen = new Map();
  }

  consume(assertionId, expiresAtMs) {
    const now = Date.now();
    for (const [id, expiry] of this.seen) {
      if (expiry <= now) this.seen.delete(id);
    }

    if (this.seen.has(assertionId)) return false;

    // Keep the id at least until the timestamp window node-saml still accepts,
    // even if that moment is slightly ahead of the raw NotOnOrAfter.
    const rememberUntil = Math.max(expiresAtMs, now + 1000);
    this.seen.set(assertionId, rememberUntil);
    return true;
  }
}
