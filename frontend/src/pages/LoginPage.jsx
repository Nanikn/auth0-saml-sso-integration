import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ERRORS, flowLabel, getJson } from '../api.js';

export default function LoginPage() {
  const [params] = useSearchParams();
  const [links, setLinks] = useState(null);
  const [session, setSession] = useState(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([getJson('/api/demo-links'), getJson('/api/me')])
      .then(([linkBody, me]) => {
        if (cancelled) return;
        setLinks(linkBody);
        setSession(me?.user ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const samlError = ERRORS[params.get('error')] ?? (params.get('error') ? ERRORS.saml_failed : '');

  return (
    <main>
      <h1>Sign in</h1>
      <p className="lede">
        Two ways in. The buttons do not call the same route.
      </p>

      {samlError ? <p className="banner bad" role="alert">{samlError}</p> : null}
      {error ? <p className="banner bad" role="alert">{error}</p> : null}
      {session ? (
        <p className="banner">
          You already have a session from <strong>{flowLabel(session.loginFlow)}</strong>.{' '}
          <Link to="/home">Open the signed-in page</Link>
        </p>
      ) : null}

      <section className="card sp">
        <p className="flow">SP-initiated login</p>
        <h2>Start in this app</h2>
        <ol>
          <li>You are on this page.</li>
          <li>This app sends a SAML AuthnRequest to Auth0.</li>
          <li>Auth0 posts a signed assertion back here, and this page shows who you are.</li>
        </ol>
        <a className="button" href="/api/saml/login">Login with SSO</a>
        <p className="url">/api/saml/login</p>
      </section>

      <section className="card idp">
        <p className="flow">IdP-initiated login</p>
        <h2>Start at Auth0</h2>
        <ol>
          <li>You leave this app. There is no AuthnRequest.</li>
          <li>Auth0 authenticates you and posts an unsolicited assertion to this app.</li>
          <li>You land on the signed-in page without using the button above.</li>
        </ol>
        {links ? (
          <>
            <a className="button" href={links.idpInitiatedLoginUrl}>Start at Auth0</a>
            <p className="url">{links.idpInitiatedLoginUrl}</p>
          </>
        ) : error ? null : (
          <p>Loading the Auth0 login URL…</p>
        )}
      </section>
    </main>
  );
}
