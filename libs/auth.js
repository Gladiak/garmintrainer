'use strict';

const { scrypt, randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { Router } = require('express');
const { InputError } = require('./validation');
const derive = promisify(scrypt);
const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const COOKIE = 'garmintrainer_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64, SCRYPT);
  return `scrypt$32768$8$3$${salt}$${hash.toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$32768$8$3' || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  const hash = await derive(password, parts[4], 64, SCRYPT);
  return timingSafeEqual(hash, Buffer.from(parts[5], 'hex'));
}
function validateRegistration(body) {
  const { username, email, password, passwordConfirmation } = body || {};
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,40}$/.test(username.trim())) throw new InputError('Nome utente non valido.', 400, 'INVALID_USERNAME');
  if (typeof email !== 'string' || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new InputError('Email non valida.', 400, 'INVALID_EMAIL');
  if (typeof password !== 'string' || password.length < 15 || password.length > 128) throw new InputError('La password deve contenere da 15 a 128 caratteri.', 400, 'INVALID_PASSWORD');
  if (password !== passwordConfirmation) throw new InputError('Le password non coincidono.', 400, 'PASSWORD_MISMATCH');
  return { username: username.trim(), email: email.trim().toLowerCase(), password };
}
function sessionToken(req) {
  const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`));
  const value = cookie?.slice(COOKIE.length + 1);
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(value) ? value : null;
}
function createAuthentication({ getDatabase, cookieSecure = false, allowedOrigins = [] }) {
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: cookieSecure, path: '/' };
  const attempts = new Map();
  // A real scrypt calculation is also performed for an unknown username.
  const dummyHash = hashPassword(randomBytes(32).toString('hex'));
  function sameOrigin(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('Origin');
    const ownOrigin = `${req.protocol}://${req.get('Host')}`;
    if ((origin && origin !== ownOrigin && !allowedOrigins.includes(origin)) || req.get('Sec-Fetch-Site') === 'cross-site') {
      throw new InputError('Origine non consentita.', 403, 'CSRF_INVALID');
    }
    next();
  }
  function limit(req, res, next) {
    const now = Date.now(); const key = req.ip;
    for (const [ip, value] of attempts) if (value.until <= now) attempts.delete(ip);
    const value = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    value.count++;
    if (attempts.size >= 10000 && !attempts.has(key)) attempts.delete(attempts.keys().next().value);
    attempts.set(key, value);
    if (value.count > 30) {
      res.set('Retry-After', String(Math.ceil((value.until - now) / 1000)));
      throw new InputError('Troppi tentativi. Riprova più tardi.', 429, 'AUTH_RATE_LIMIT');
    }
    next();
  }
  async function requireUser(req, res, next) {
    const token = sessionToken(req);
    const session = token ? await getDatabase().getAuthSession(digest(token)) : null;
    if (!session) throw new InputError('Accedi al tuo account.', 401, 'AUTH_REQUIRED');
    req.user = await getDatabase().getUser(session.userId);
    if (!req.user) throw new InputError('Accedi al tuo account.', 401, 'AUTH_REQUIRED');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !same(req.get('X-CSRF-Token'), session.csrfToken)) throw new InputError('Sessione non valida. Aggiorna la pagina.', 403, 'CSRF_INVALID');
    req.authSession = session;
    req.profile = await getDatabase().getUserProfile(req.user.id);
    next();
  }
  async function sessionResponse(user, csrfToken) {
    return { user, profile: await getDatabase().getUserProfile(user.id), csrfToken };
  }
  async function signIn(req, res, user, status = 200) {
    const oldToken = sessionToken(req);
    if (oldToken) await getDatabase().deleteAuthSession(digest(oldToken));
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    await getDatabase().createAuthSession({ tokenHash: digest(token), userId: user.id, csrfToken, expiresAt: Date.now() + SESSION_MS });
    res.cookie(COOKIE, token, { ...cookieOptions, maxAge: SESSION_MS });
    res.status(status).json(await sessionResponse(user, csrfToken));
  }
  const router = Router();
  router.post('/register', limit, async (req, res) => {
    const values = validateRegistration(req.body);
    const user = await getDatabase().createUser({ username: values.username, email: values.email, passwordHash: await hashPassword(values.password) });
    await signIn(req, res, user, 201);
  });
  router.post('/login', limit, async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 40 || password.length > 128) throw new InputError('Credenziali non valide.', 401, 'LOGIN_FAILED');
    const found = await getDatabase().findUser(username.trim());
    const valid = await verifyPassword(password, found?.passwordHash || await dummyHash);
    if (!found || !valid) throw new InputError('Credenziali non valide.', 401, 'LOGIN_FAILED');
    const { passwordHash, ...user } = found;
    await signIn(req, res, user);
  });
  router.get('/session', requireUser, async (req, res) => res.json(await sessionResponse(req.user, req.authSession.csrfToken)));
  router.post('/logout', requireUser, async (req, res) => {
    await getDatabase().deleteAuthSession(digest(sessionToken(req)));
    res.clearCookie(COOKIE, cookieOptions);
    res.status(204).end();
  });
  return { router, requireUser, sameOrigin };
}

module.exports = { createAuthentication, hashPassword, verifyPassword, validateRegistration };
