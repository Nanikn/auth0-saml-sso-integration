import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import { createApp } from '../src/app.js';
import { ASSERTION_MAX_AGE_MS, CLOCK_SKEW_MS, loadConfig } from '../src/config.js';
import { acceptAssertion, SamlAcceptanceError } from '../src/saml/assertionGuard.js';
import { buildSamlOptions } from '../src/saml/createClient.js';
import { identityFromProfile } from '../src/saml/identity.js';
import { parseIdpMetadata } from '../src/saml/idpMetadata.js';
import { ReplayCache } from '../src/saml/replayCache.js';
import { createSessionStore } from '../src/auth/sessionStore.js';

const ACS = 'http://localhost:5173/api/saml/acs';
const ISSUER = 'urn:tenant.example';

function config() {
  return {
    sessionSecret: 'test-session-secret-must-be-32-chars',
    appBaseUrl: 'http://localhost:5173',
    spEntityId: 'urn:platform:sp',
    acsUrl: ACS,
    sloUrl: 'http://localhost:5173/api/saml/slo',
    idpLoginUrl: 'https://tenant.example/samlp/client123',
    spInitiatedLogoutUrl: 'https://tenant.example/v2/logout?client_id=client123&returnTo=http%3A%2F%2Flocalhost%3A5173%2Flogged-out%2Fsp',
    idpInitiatedLogoutUrl: 'https://tenant.example/v2/logout?client_id=client123&returnTo=http%3A%2F%2Flocalhost%3A5173%2Fapi%2Fsaml%2Flogout%2Fcallback',
    cookieSecure: false,
  };
}

function assertionProfile({
  assertionId = '_assert1',
  inResponseTo = '_req1',
  recipient = ACS,
  issuer = ISSUER,
  nameID = 'auth0|user1',
} = {}) {
  const notOnOrAfter = new Date(Date.now() + 60_000).toISOString();
  return {
    nameID,
    nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
    issuer,
    sessionIndex: '_session',
    inResponseTo,
    attributes: {
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'demo.user@example.com',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name': 'Demo User',
    },
    getAssertion() {
      return {
        Assertion: {
          $: { ID: assertionId },
          Conditions: [{ $: { NotOnOrAfter: notOnOrAfter } }],
          Subject: [{
            SubjectConfirmation: [{
              $: { Method: 'urn:oasis:names:tc:SAML:2.0:cm:bearer' },
              SubjectConfirmationData: [{ $: { Recipient: recipient, NotOnOrAfter: notOnOrAfter } }],
            }],
          }],
        },
      };
    },
  };
}

test('config rejects a placeholder secret and a domain with a scheme', () => {
  assert.throws(
    () => loadConfig({}),
    /AUTH0_DOMAIN/,
  );
  assert.throws(
    () => loadConfig({
      AUTH0_DOMAIN: 'https://tenant.example',
      AUTH0_CLIENT_ID: 'abc',
      SESSION_SECRET: 'x'.repeat(40),
      APP_BASE_URL: 'http://localhost:5173',
    }),
    /host only/,
  );
  assert.throws(
    () => loadConfig({
      AUTH0_DOMAIN: 'tenant.example',
      AUTH0_CLIENT_ID: 'abc',
      SESSION_SECRET: 'replace-with-a-long-random-string',
      APP_BASE_URL: 'http://localhost:5173',
    }),
    /SESSION_SECRET/,
  );
});

test('IdP metadata keeps the signing cert and the redirect endpoints', () => {
  const xml = `<?xml version="1.0"?>
    <md:EntityDescriptor entityID="urn:dev-abc.us.auth0.com" xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata">
      <md:IDPSSODescriptor>
        <md:KeyDescriptor use="signing">
          <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
            <ds:X509Data><ds:X509Certificate>QU JD</ds:X509Certificate></ds:X509Data>
          </ds:KeyInfo>
        </md:KeyDescriptor>
        <md:KeyDescriptor use="encryption">
          <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
            <ds:X509Data><ds:X509Certificate>RU5D</ds:X509Certificate></ds:X509Data>
          </ds:KeyInfo>
        </md:KeyDescriptor>
        <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://dev-abc.us.auth0.com/samlp/client/post"/>
        <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://dev-abc.us.auth0.com/samlp/client"/>
        <md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://dev-abc.us.auth0.com/samlp/client/logout"/>
      </md:IDPSSODescriptor>
    </md:EntityDescriptor>`;

  const parsed = parseIdpMetadata(xml);
  assert.deepEqual(parsed.certs, ['QUJD']);
  assert.equal(parsed.entityId, 'urn:dev-abc.us.auth0.com');
  assert.equal(parsed.ssoUrl, 'https://dev-abc.us.auth0.com/samlp/client');
  assert.equal(parsed.sloUrl, 'https://dev-abc.us.auth0.com/samlp/client/logout');
});

test('SAML client options require a signed assertion, audience, and ifPresent', () => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const options = buildSamlOptions(config(), {
    certs: [pem],
    ssoUrl: 'https://tenant.example/samlp/client123',
    sloUrl: 'https://tenant.example/samlp/client123/logout',
    issuer: ISSUER,
  });

  assert.equal(options.wantAssertionsSigned, true);
  assert.equal(options.wantAuthnResponseSigned, false);
  assert.equal(options.validateInResponseTo, ValidateInResponseTo.ifPresent);
  assert.equal(options.audience, 'urn:platform:sp');
  assert.equal(options.issuer, 'urn:platform:sp');
  assert.equal(options.callbackUrl, ACS);
  assert.equal(options.disableRequestedAuthnContext, true);
  assert.equal(options.identifierFormat, null);
  assert.equal(options.maxAssertionAgeMs, ASSERTION_MAX_AGE_MS);
  assert.equal(options.acceptedClockSkewMs, CLOCK_SKEW_MS);

  const saml = new SAML(options);
  const metadata = saml.generateServiceProviderMetadata(null, null);
  assert.match(metadata, /entityID="urn:platform:sp"/);
  assert.match(metadata, /AssertionConsumerService/);
  assert.match(metadata, new RegExp(ACS.replaceAll('/', '\\/')));
  assert.match(metadata, /WantAssertionsSigned="true"/);
});

test('assertion guard rejects a replay, a bad recipient, and a foreign issuer', () => {
  const cache = new ReplayCache();
  const first = assertionProfile();
  const id = acceptAssertion(first, {
    cache,
    acsUrl: ACS,
    expectedIssuer: ISSUER,
    clockSkewMs: 0,
  });
  assert.equal(id, '_assert1');

  assert.throws(
    () => acceptAssertion(assertionProfile(), {
      cache,
      acsUrl: ACS,
      expectedIssuer: ISSUER,
      clockSkewMs: 0,
    }),
    (err) => err instanceof SamlAcceptanceError && err.code === 'replay',
  );

  assert.throws(
    () => acceptAssertion(assertionProfile({ assertionId: '_other', recipient: 'https://evil.example/acs' }), {
      cache,
      acsUrl: ACS,
      expectedIssuer: ISSUER,
      clockSkewMs: 0,
    }),
    (err) => err.code === 'recipient',
  );

  assert.throws(
    () => acceptAssertion(assertionProfile({ assertionId: '_issuer', issuer: 'urn:other' }), {
      cache,
      acsUrl: ACS,
      expectedIssuer: ISSUER,
      clockSkewMs: 0,
    }),
    (err) => err.code === 'issuer',
  );
});

test('a rejected assertion id is consumed, so a later valid replay still fails', () => {
  const cache = new ReplayCache();
  const bad = assertionProfile({ assertionId: '_burned', issuer: 'urn:other' });
  assert.throws(() => acceptAssertion(bad, {
    cache,
    acsUrl: ACS,
    expectedIssuer: ISSUER,
    clockSkewMs: 0,
  }));
  assert.throws(
    () => acceptAssertion(assertionProfile({ assertionId: '_burned' }), {
      cache,
      acsUrl: ACS,
      expectedIssuer: ISSUER,
      clockSkewMs: 0,
    }),
    (err) => err.code === 'replay',
  );
});

test('replay cache drops expired ids', () => {
  const cache = new ReplayCache();
  cache.seen.set('stale', Date.now() - 5);
  assert.equal(cache.consume('fresh', Date.now() + 10_000), true);
  assert.equal(cache.seen.has('stale'), false);
  assert.equal(cache.consume('fresh', Date.now() + 10_000), false);
});

test('login flow is taken from InResponseTo, and email comes from the mapped claim', () => {
  const sp = identityFromProfile(assertionProfile({ inResponseTo: '_abc' }), '_assert1');
  assert.equal(sp.loginFlow, 'sp-initiated');
  assert.equal(sp.email, 'demo.user@example.com');
  assert.equal(sp.displayName, 'Demo User');
  assert.equal(sp.nameId, 'auth0|user1');

  const idp = identityFromProfile(assertionProfile({ inResponseTo: null }), '_assert2');
  assert.equal(idp.loginFlow, 'idp-initiated');
});

test('sessions can be destroyed by NameID without the cookie', () => {
  const store = createSessionStore({ ttlMs: 1000 });
  const sid = store.create({ nameId: 'auth0|user1', email: 'demo.user@example.com' });
  assert.equal(store.get(sid).email, 'demo.user@example.com');
  assert.equal(store.destroyByNameId('auth0|user1'), 1);
  assert.equal(store.get(sid), null);
  assert.equal(store.destroyByNameId('missing'), 0);
});

test('HTTP: both login flows, replay, and logout that fails closed', async () => {
  const profiles = {
    sp: assertionProfile({ assertionId: '_sp', inResponseTo: '_from-sp', nameID: 'auth0|sp-user' }),
    idp: assertionProfile({ assertionId: '_idp', inResponseTo: null, nameID: 'auth0|idp-user' }),
    replay: assertionProfile({ assertionId: '_replay', inResponseTo: '_from-sp', nameID: 'auth0|replay-user' }),
    slo: assertionProfile({ assertionId: '_slo', inResponseTo: null, nameID: 'auth0|slo-user' }),
  };

  let logoutShouldFail = false;
  const saml = {
    generateServiceProviderMetadata: () => '<EntityDescriptor entityID="urn:platform:sp"/>',
    getAuthorizeUrlAsync: async (relayState) => `https://tenant.example/samlp/client123?RelayState=${relayState}`,
    validatePostResponseAsync: async (body) => ({ profile: profiles[body.SAMLResponse] }),
    validatePostRequestAsync: async () => {
      if (logoutShouldFail) throw new Error('Invalid signature on documentElement');
      return { profile: { nameID: 'auth0|slo-user' } };
    },
    getLogoutResponseUrlAsync: async () => 'https://tenant.example/samlp/client123/logout?SAMLResponse=ok',
  };

  const app = createApp({ config: config(), saml, idp: { issuer: ISSUER } });
  const server = app.listen(0);
  await once(server, 'listening');
  const port = server.address().port;

  try {
    const metadata = await request(port, { path: '/api/saml/metadata' });
    assert.equal(metadata.status, 200);
    assert.match(metadata.body, /urn:platform:sp/);

    const links = await request(port, { path: '/api/demo-links' });
    assert.equal(links.status, 200);
    const linkBody = JSON.parse(links.body);
    assert.equal(linkBody.idpInitiatedLoginUrl, 'https://tenant.example/samlp/client123');
    assert.equal(JSON.stringify(linkBody).includes('sessionSecret'), false);

    const anonymous = await request(port, { path: '/api/me' });
    assert.equal(anonymous.status, 401);

    const spLogin = await request(port, { path: '/api/saml/login' });
    assert.equal(spLogin.status, 302);
    assert.match(spLogin.headers.location, /SAMLRequest|RelayState=platform/);

    const spAcs = await postSaml(port, '/api/saml/acs', 'sp');
    assert.equal(spAcs.status, 302);
    assert.equal(spAcs.headers.location, 'http://localhost:5173/home');
    const spCookie = cookieHeader(spAcs);
    const spMe = await request(port, { path: '/api/me', headers: { cookie: spCookie } });
    assert.equal(JSON.parse(spMe.body).user.loginFlow, 'sp-initiated');
    assert.equal(JSON.parse(spMe.body).user.email, 'demo.user@example.com');

    const idpAcs = await postSaml(port, '/api/saml/acs', 'idp');
    assert.equal(idpAcs.status, 302);
    const idpMe = await request(port, { path: '/api/me', headers: { cookie: cookieHeader(idpAcs) } });
    assert.equal(JSON.parse(idpMe.body).user.loginFlow, 'idp-initiated');

    const firstReplay = await postSaml(port, '/api/saml/acs', 'replay');
    assert.equal(firstReplay.headers.location, 'http://localhost:5173/home');
    const secondReplay = await postSaml(port, '/api/saml/acs', 'replay');
    assert.equal(secondReplay.status, 302);
    assert.match(secondReplay.headers.location, /error=replay$/);

    const sloLogin = await postSaml(port, '/api/saml/acs', 'slo');
    const sloCookie = cookieHeader(sloLogin);
    logoutShouldFail = true;
    const rejectedLogout = await postSaml(port, '/api/saml/slo', 'ignored', 'SAMLRequest');
    assert.equal(rejectedLogout.status, 400);
    const stillIn = await request(port, { path: '/api/me', headers: { cookie: sloCookie } });
    assert.equal(stillIn.status, 200);

    logoutShouldFail = false;
    const acceptedLogout = await postSaml(port, '/api/saml/slo', 'ignored', 'SAMLRequest');
    assert.equal(acceptedLogout.status, 302);
    assert.match(acceptedLogout.headers.location, /SAMLResponse=ok/);
    const gone = await request(port, { path: '/api/me', headers: { cookie: sloCookie } });
    assert.equal(gone.status, 401);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

function cookieHeader(response) {
  const raw = response.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((item) => item.split(';')[0]).join('; ');
}

function request(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    if (body) req.end(body);
    else req.end();
  });
}

function postSaml(port, path, value, field = 'SAMLResponse') {
  const body = new URLSearchParams({ [field]: value }).toString();
  return request(port, {
    method: 'POST',
    path,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': Buffer.byteLength(body),
    },
    body,
  });
}
