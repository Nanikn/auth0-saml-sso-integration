const EMAIL_CLAIMS = [
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'email',
  'mail',
];

const NAME_CLAIMS = [
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
  'name',
];

function claim(profile, keys) {
  for (const key of keys) {
    const value = profile[key] ?? profile.attributes?.[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === 'string' && item.trim() !== '');
      if (first) return first.trim();
    }
  }
  return null;
}

function copyAttributes(profile) {
  const source = profile.attributes && typeof profile.attributes === 'object' ? profile.attributes : {};
  const safe = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (typeof value === 'string') safe[key] = value;
    else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) safe[key] = value;
  }
  return safe;
}

/**
 * Session record derived from a verified profile.
 * loginFlow is decided from InResponseTo, which node-saml only sets when the
 * signed assertion (or a signed response) actually carries it. RelayState is
 * ignored: the browser, or Auth0, can set it to anything.
 */
export function identityFromProfile(profile, assertionId) {
  if (!profile.nameID) {
    throw new Error('The assertion did not include a NameID.');
  }

  return {
    nameId: profile.nameID,
    nameIdFormat: profile.nameIDFormat ?? null,
    email: claim(profile, EMAIL_CLAIMS),
    displayName: claim(profile, NAME_CLAIMS),
    issuer: profile.issuer ?? null,
    sessionIndex: profile.sessionIndex ?? null,
    assertionId,
    loginFlow: profile.inResponseTo ? 'sp-initiated' : 'idp-initiated',
    loggedInAt: new Date().toISOString(),
    attributes: copyAttributes(profile),
  };
}
