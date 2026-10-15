export const ERRORS = {
  replay: 'This SAML assertion was already used. Replay protection rejected it.',
  in_response_to: 'This response did not match a login this app started, or that login was already used.',
  audience: 'The assertion audience does not match this application. In Auth0 it must be urn:platform:sp.',
  recipient: 'The assertion recipient does not match this app sign-in URL.',
  recipient_missing: 'The assertion did not name this app as the recipient.',
  signature: 'The SAML signature could not be verified.',
  expired: 'The SAML assertion is expired or not valid yet.',
  issuer: 'The assertion was not issued by the configured Auth0 tenant.',
  assertion_id: 'The assertion did not include an ID, so it was rejected.',
  saml_failed: 'SAML sign-in failed. The API log has the reason.',
};

export function flowLabel(flow) {
  if (flow === 'sp-initiated') return 'SP-initiated login';
  if (flow === 'idp-initiated') return 'IdP-initiated login';
  return 'Unknown login';
}

export async function getJson(path) {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`The API returned ${response.status} for ${path}. Is the backend running?`);
  }
  return response.json();
}
