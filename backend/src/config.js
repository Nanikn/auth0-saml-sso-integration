import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Repo-root .env. Importing this module loads it once; loadConfig() reads whatever
// object it is given so tests can pass a fake environment.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const ASSERTION_MAX_AGE_MS = 10 * 60 * 1000;
export const CLOCK_SKEW_MS = 2 * 60 * 1000;
export const REQUEST_ID_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_SP_ENTITY_ID = 'urn:platform:sp';

function required(env, name) {
  const value = env[name];
  if (value == null || String(value).trim() === '') {
    throw new Error(`Missing ${name}. Copy .env.example to .env at the repo root and fill it in.`);
  }
  return String(value).trim();
}

function auth0LogoutUrl(domain, clientId, returnTo) {
  const url = new URL(`https://${domain}/v2/logout`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('returnTo', returnTo);
  return url.toString();
}

export function loadConfig(env = process.env) {
  const domain = required(env, 'AUTH0_DOMAIN').replace(/\.$/, '');
  if (domain.includes('://') || domain.includes('/')) {
    throw new Error(
      'AUTH0_DOMAIN must be the host only, for example dev-abc123.us.auth0.com',
    );
  }

  const clientId = required(env, 'AUTH0_CLIENT_ID');
  const sessionSecret = required(env, 'SESSION_SECRET');
  if (sessionSecret.length < 32 || sessionSecret.includes('replace-with')) {
    throw new Error('SESSION_SECRET must be at least 32 characters and not the placeholder from .env.example.');
  }

  const appBaseUrl = required(env, 'APP_BASE_URL').replace(/\/$/, '');
  let parsedBase;
  try {
    parsedBase = new URL(appBaseUrl);
  } catch {
    throw new Error('APP_BASE_URL must be an absolute URL, for example http://localhost:5173');
  }
  if (parsedBase.pathname !== '/' || parsedBase.search || parsedBase.hash) {
    throw new Error('APP_BASE_URL must be an origin only, with no path, query, or hash.');
  }

  const spEntityId = (env.SP_ENTITY_ID && String(env.SP_ENTITY_ID).trim()) || DEFAULT_SP_ENTITY_ID;
  const port = Number(env.PORT || 4000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT must be a positive integer.');
  }

  const idpCert = env.SAML_IDP_CERT && String(env.SAML_IDP_CERT).trim()
    ? normalizeCert(String(env.SAML_IDP_CERT))
    : null;

  return {
    port,
    auth0Domain: domain,
    auth0ClientId: clientId,
    sessionSecret,
    appBaseUrl,
    spEntityId,
    acsUrl: `${appBaseUrl}/api/saml/acs`,
    sloUrl: `${appBaseUrl}/api/saml/slo`,
    idpMetadataUrl: `https://${domain}/samlp/metadata/${clientId}`,
    // Visiting the SSO URL with no AuthnRequest is Auth0's IdP-initiated login.
    idpLoginUrl: `https://${domain}/samlp/${clientId}`,
    spInitiatedLogoutUrl: auth0LogoutUrl(domain, clientId, `${appBaseUrl}/logged-out/sp`),
    idpInitiatedLogoutUrl: auth0LogoutUrl(
      domain,
      clientId,
      `${appBaseUrl}/api/saml/logout/callback`,
    ),
    idpCert,
    cookieSecure: parsedBase.protocol === 'https:',
  };
}

export function normalizeCert(value) {
  return value
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
}
