export class SamlAcceptanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SamlAcceptanceError';
    this.code = code;
  }
}

const KNOWN_CODES = new Set([
  'replay',
  'in_response_to',
  'audience',
  'recipient',
  'recipient_missing',
  'signature',
  'expired',
  'issuer',
  'assertion_id',
  'saml_failed',
]);

export function classifySamlError(err) {
  if (err && KNOWN_CODES.has(err.code)) return err.code;
  const message = String(err?.message ?? '');
  if (/InResponseTo/i.test(message)) return 'in_response_to';
  if (/audience/i.test(message)) return 'audience';
  if (/signature/i.test(message)) return 'signature';
  if (/expired|not yet valid|too old/i.test(message)) return 'expired';
  if (/issuer/i.test(message)) return 'issuer';
  if (/recipient/i.test(message)) return 'recipient';
  return 'saml_failed';
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function first(value) {
  return asArray(value)[0];
}

function earliestExpiryMs(assertion) {
  const stamps = [];
  const conditions = first(assertion.Conditions);
  if (conditions?.$?.NotOnOrAfter) stamps.push(Date.parse(conditions.$.NotOnOrAfter));

  const subject = first(assertion.Subject);
  for (const confirmation of asArray(subject?.SubjectConfirmation)) {
    const data = first(confirmation.SubjectConfirmationData);
    if (data?.$?.NotOnOrAfter) stamps.push(Date.parse(data.$.NotOnOrAfter));
  }

  const usable = stamps.filter((stamp) => Number.isFinite(stamp));
  if (usable.length === 0) {
    throw new SamlAcceptanceError(
      'expired',
      'The assertion did not include a NotOnOrAfter timestamp to bound replay.',
    );
  }
  return Math.min(...usable);
}

const BEARER = 'urn:oasis:names:tc:SAML:2.0:cm:bearer';

function assertRecipient(assertion, acsUrl) {
  const subject = first(assertion.Subject);
  const confirmations = asArray(subject?.SubjectConfirmation);
  let sawRecipient = false;

  for (const confirmation of confirmations) {
    const data = first(confirmation.SubjectConfirmationData);
    const recipient = data?.$?.Recipient;
    if (!recipient) continue;
    sawRecipient = true;
    const method = confirmation.$?.Method;
    const bearer = method == null || method === BEARER;
    if (bearer && recipient === acsUrl) return;
  }

  if (!sawRecipient) {
    throw new SamlAcceptanceError(
      'recipient_missing',
      'The signed assertion did not name a Recipient.',
    );
  }

  throw new SamlAcceptanceError(
    'recipient',
    'The assertion Recipient does not match this service provider ACS URL.',
  );
}

/**
 * Checks that belong to us, after node-saml has already verified the signature,
 * audience, timestamps, and (when present) InResponseTo.
 *
 * Recipient is checked here because @node-saml/node-saml does not compare
 * SubjectConfirmationData Recipient to the ACS URL. Audience is not re-checked
 * here; buildSamlOptions sets `audience`, and the library rejects a mismatch.
 */
export function acceptAssertion(profile, { cache, acsUrl, expectedIssuer, clockSkewMs }) {
  const parsed = profile.getAssertion?.();
  const assertion = parsed?.Assertion;
  if (!assertion) {
    throw new SamlAcceptanceError('assertion_id', 'The verified assertion payload was missing.');
  }

  const assertionId = assertion.$?.ID;
  if (!assertionId || typeof assertionId !== 'string') {
    throw new SamlAcceptanceError('assertion_id', 'The assertion did not include an ID.');
  }

  const expiresAt = earliestExpiryMs(assertion) + clockSkewMs;
  if (!cache.consume(assertionId, expiresAt)) {
    throw new SamlAcceptanceError('replay', 'This SAML assertion ID was already accepted.');
  }

  if (!expectedIssuer || profile.issuer !== expectedIssuer) {
    throw new SamlAcceptanceError(
      'issuer',
      'The assertion issuer does not match the configured Auth0 tenant.',
    );
  }

  assertRecipient(assertion, acsUrl);
  return assertionId;
}
