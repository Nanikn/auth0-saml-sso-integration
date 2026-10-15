const COOKIE_NAME = 'platform.sid';

export function sessionMiddleware(store, { secure, ttlMs }) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: ttlMs,
    signed: true,
  };

  return (req, res, next) => {
    const sid = req.signedCookies?.[COOKIE_NAME];
    const user = typeof sid === 'string' ? store.get(sid) : null;
    req.sessionUser = user;
    req.sessionId = user ? sid : null;

    res.establishSession = (sessionUser) => {
      if (req.sessionId) store.destroy(req.sessionId);
      const created = store.create(sessionUser);
      res.cookie(COOKIE_NAME, created, cookieOptions);
    };

    res.clearSession = () => {
      if (req.sessionId) store.destroy(req.sessionId);
      res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
      });
    };

    next();
  };
}

export { COOKIE_NAME };
