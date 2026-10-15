import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { flowLabel, getJson } from '../api.js';

export default function HomePage() {
  const [user, setUser] = useState(undefined);
  const [links, setLinks] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([getJson('/api/me'), getJson('/api/demo-links')])
      .then(([me, linkBody]) => {
        if (cancelled) return;
        setUser(me?.user ?? null);
        setLinks(linkBody);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <main><p className="banner bad" role="alert">{error}</p></main>;
  if (user === undefined) return <main><p>Loading session…</p></main>;
  if (user === null) {
    return (
      <main>
        <h1>Not signed in</h1>
        <p>There is no session. Start from the sign-in page and pick a flow.</p>
        <Link className="button" to="/">Back to sign in</Link>
      </main>
    );
  }

  const rows = [
    ['Email', user.email || 'Not in the assertion'],
    ['Name', user.displayName || 'Not in the assertion'],
    ['NameID', user.nameId],
    ['NameID format', user.nameIdFormat || '—'],
    ['Issuer', user.issuer],
    ['Assertion ID', user.assertionId],
    ['Session index', user.sessionIndex || '—'],
    ['Signed in at', user.loggedInAt],
  ];

  return (
    <main>
      <p className={`flow ${user.loginFlow === 'idp-initiated' ? 'idp-text' : 'sp-text'}`}>
        {flowLabel(user.loginFlow)}
      </p>
      <h1>Logged in as: {user.email || user.nameId}</h1>
      <p className="lede">
        This label was stored when the assertion was accepted. It does not come from the address bar.
        SP-initiated means the assertion answered a request this app sent. IdP-initiated means it did not.
      </p>

      <dl className="facts">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {user.attributes && Object.keys(user.attributes).length > 0 ? (
        <details>
          <summary>Attributes from the assertion</summary>
          <dl className="facts">
            {Object.entries(user.attributes).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{Array.isArray(value) ? value.join(', ') : value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      <section className="card sp">
        <p className="flow">SP-initiated logout</p>
        <h2>Start in this app</h2>
        <p>
          Ends the session here, then sends the browser to Auth0 so the Auth0 session ends too.
          You should be asked to sign in again next time.
        </p>
        <form method="post" action="/api/saml/logout">
          <button className="button" type="submit">Log out</button>
        </form>
      </section>

      <section className="card idp">
        <p className="flow">IdP-initiated logout</p>
        <h2>Start at Auth0</h2>
        <p>
          This link does not call this app first. Auth0 ends its session, then returns to this app,
          and the return deletes the local session.
        </p>
        {links ? (
          <>
            <a className="button" href={links.idpInitiatedLogoutUrl}>Log out at Auth0</a>
            <p className="url">{links.idpInitiatedLogoutUrl}</p>
          </>
        ) : null}
      </section>
    </main>
  );
}
