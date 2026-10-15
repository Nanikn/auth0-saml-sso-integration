import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import {
  ASSERTION_MAX_AGE_MS,
  CLOCK_SKEW_MS,
  REQUEST_ID_TTL_MS,
} from '../config.js';
import { parseIdpMetadata } from './idpMetadata.js';

export function buildSamlOptions(config, idp) {
  return {
    callbackUrl: config.acsUrl,
    logoutCallbackUrl: config.sloUrl,
    issuer: config.spEntityId,
    // Library compares this to AudienceRestriction. IdP-initiated assertions
    // have no AuthnRequest to copy an audience from, so Auth0 must be told
    // this value explicitly. See auth0/saml-addon-settings.json.
    audience: config.spEntityId,
    idpCert: idp.certs,
    entryPoint: idp.ssoUrl,
    logoutUrl: idp.sloUrl,
    // Checked on logout messages. Login issuer is checked in acceptAssertion
    // against the same value, because this option does not apply to assertions.
    idpIssuer: idp.issuer,
    // Auth0's default is to sign the assertion and not the response.
    // signResponse:true would sign the response *instead of* the assertion,
    // which this setting would reject. Leave the addon flag false.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    // "always" would reject IdP-initiated login (no InResponseTo).
    // "ifPresent" still burns the AuthnRequest id on the SP-initiated path.
    // Assertion-ID replay for both paths lives in ReplayCache.
    validateInResponseTo: ValidateInResponseTo.ifPresent,
    requestIdExpirationPeriodMs: REQUEST_ID_TTL_MS,
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    maxAssertionAgeMs: ASSERTION_MAX_AGE_MS,
    // Auth0 database logins often do not satisfy PasswordProtectedTransport
    // exactly, and a strict request then fails after the user typed a correct
    // password. Omit RequestedAuthnContext and accept Auth0's class.
    disableRequestedAuthnContext: true,
    // Null omits NameIDPolicy Format. The addon chooses NameID (Auth0 user_id).
    // Requesting emailAddress here would fight that and key users on a mutable email.
    identifierFormat: null,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
  };
}

export async function loadIdentityProvider(config, fetchImpl = globalThis.fetch) {
  if (config.idpCert) {
    return {
      certs: [config.idpCert],
      ssoUrl: config.idpLoginUrl,
      sloUrl: `https://${config.auth0Domain}/samlp/${config.auth0ClientId}/logout`,
      issuer: `urn:${config.auth0Domain}`,
      source: 'env',
    };
  }

  const response = await fetchImpl(config.idpMetadataUrl);
  if (!response.ok) {
    throw new Error(
      `Could not download IdP metadata (${response.status}) from ${config.idpMetadataUrl}. ` +
        'Check AUTH0_DOMAIN and AUTH0_CLIENT_ID, and that the SAML addon is enabled.',
    );
  }

  const parsed = parseIdpMetadata(await response.text());
  if (parsed.certs.length === 0) {
    throw new Error(`IdP metadata at ${config.idpMetadataUrl} did not contain a signing certificate.`);
  }

  return {
    certs: parsed.certs,
    ssoUrl: parsed.ssoUrl ?? config.idpLoginUrl,
    sloUrl: parsed.sloUrl ?? `https://${config.auth0Domain}/samlp/${config.auth0ClientId}/logout`,
    issuer: parsed.entityId ?? `urn:${config.auth0Domain}`,
    source: 'metadata',
  };
}

export function createSamlClient(config, idp) {
  return new SAML(buildSamlOptions(config, idp));
}
