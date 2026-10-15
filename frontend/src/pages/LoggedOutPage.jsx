import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getJson } from '../api.js';

const COPY = {
  sp: {
    flow: 'SP-initiated logout',
    title: 'Signed out from this app',
    body: 'The app deleted the local session, then sent the browser to Auth0 to end the Auth0 session. The next login should ask for a password again, unless some other Auth0 application still has a session.',
  },
  idp: {
    flow: 'IdP-initiated logout',
    title: 'Signed out from Auth0',
    body: 'Logout started at Auth0. When Auth0 sent the browser back, this app deleted the local session. This page was not opened by the Log out button in the app.',
  },
};

export default function LoggedOutPage() {
  const { via } = useParams();
  const copy = COPY[via] ?? {
    flow: 'Logout',
    title: 'Signed out',
    body: 'The local session is cleared when this page is reached through one of the two logout paths.',
  };
  const [sessionState, setSessionState] = useState('checking');

  useEffect(() => {
    let cancelled = false;
    getJson('/api/me')
      .then((me) => {
        if (!cancelled) setSessionState(me?.user ? 'still-in' : 'ended');
      })
      .catch(() => {
        if (!cancelled) setSessionState('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const proof = {
    checking: 'Checking the local session…',
    ended: 'Local session: none. /api/me returned unauthenticated.',
    'still-in': 'Local session: still present. The logout return did not clear it.',
    unknown: 'Could not reach /api/me to confirm the session.',
  }[sessionState];

  return (
    <main>
      <p className={`flow ${via === 'idp' ? 'idp-text' : 'sp-text'}`}>{copy.flow}</p>
      <h1>{copy.title}</h1>
      <p className="lede">{copy.body}</p>
      <p className={`banner ${sessionState === 'still-in' ? 'bad' : ''}`} role="status">{proof}</p>
      <Link className="button" to="/">Back to sign in</Link>
    </main>
  );
}
