'use strict';

const { randomUUID } = require('node:crypto');
const { InputError, validateProfile, validateSession } = require('../libs/validation');
const themes = new Set(require('../libs/themes.json').map(theme => theme.id));

// Test double for fast HTTP behavior checks. Persistence and encryption are
// verified separately against the production MariaDB repository in Docker.
function createMemoryRepository() {
  const users = new Map();
  const profiles = new Map();
  const credentials = new Map();
  const authSessions = new Map();
  const sessions = new Map();
  const now = () => new Date().toISOString();
  function getProfile(id) {
    const row = profiles.get(id);
    if (!row) throw new InputError('Profilo non trovato.', 404, 'PROFILE_NOT_FOUND');
    return { ...row, needsCompletion: !row.firstName || !row.lastName || !row.primarySport };
  }
  function getUser(id) {
    const user = users.get(id);
    return user ? { id: user.id, username: user.username, email: user.email, createdAt: user.createdAt } : null;
  }
  function findSession(profileId, id) {
    const row = sessions.get(id);
    if (!row || row.profileId !== profileId) throw new InputError('Sessione non trovata.', 404);
    return row;
  }
  return {
    ready() {},
    createUser({ username, email, passwordHash }) {
      if ([...users.values()].some(user => user.username.toLowerCase() === username.toLowerCase() || user.email.toLowerCase() === email.toLowerCase())) throw new InputError('Account esistente.', 409, 'ACCOUNT_EXISTS');
      const id = randomUUID(); const profileId = randomUUID(); const createdAt = now();
      users.set(id, { id, username, email, passwordHash, profileId, createdAt });
      profiles.set(profileId, { id: profileId, firstName: '', lastName: '', primarySport: null, avatar: null, theme: 'sage-ivory', language: 'en', hasGarminKey: false, credentialRevision: 0, createdAt, updatedAt: createdAt });
      credentials.set(profileId, '');
      return getUser(id);
    },
    getUser,
    findUser(username) {
      const user = [...users.values()].find(user => user.username.toLowerCase() === username.toLowerCase());
      return user ? { ...getUser(user.id), passwordHash: user.passwordHash } : null;
    },
    getUserProfile(userId) { return getProfile(users.get(userId)?.profileId); },
    getProfile,
    updateProfile(id, input) {
      const previous = getProfile(id);
      const profile = { ...previous, ...validateProfile(input), updatedAt: now() };
      if (input.apiKey === null || (typeof input.apiKey === 'string' && input.apiKey.trim())) {
        credentials.set(id, input.apiKey?.trim() || '');
        profile.hasGarminKey = Boolean(credentials.get(id));
        profile.credentialRevision++;
      }
      profiles.set(id, profile);
      return getProfile(id);
    },
    updateProfileTheme(id, theme) {
      const profile = getProfile(id);
      if (!themes.has(theme)) throw new InputError('Tema non valido.', 400, 'INVALID_THEME');
      profiles.set(id, { ...profile, theme, updatedAt: now() });
      return getProfile(id);
    },
    getGarminCredential(id) { return { apiKey: credentials.get(id), revision: getProfile(id).credentialRevision }; },
    createAuthSession(value) { authSessions.set(value.tokenHash, { ...value }); },
    getAuthSession(hash) { const row = authSessions.get(hash); return row?.expiresAt > Date.now() ? { ...row } : null; },
    deleteAuthSession(hash) { authSessions.delete(hash); },
    listSessions(profileId) {
      getProfile(profileId);
      return [...sessions.values()].filter(row => row.profileId === profileId).sort((a, b) => `${a.date} ${a.time} ${a.createdAt}`.localeCompare(`${b.date} ${b.time} ${b.createdAt}`)).map(row => ({ ...row }));
    },
    createSession(profileId, input) {
      getProfile(profileId);
      const createdAt = now();
      const row = { ...validateSession(input), id: randomUUID(), profileId, status: 'planned', createdAt, updatedAt: createdAt };
      sessions.set(row.id, row);
      return { ...row };
    },
    setSessionStatus(profileId, id, status) {
      if (!['planned', 'completed'].includes(status)) throw new InputError('Stato non valido.', 400, undefined, 'errors.sessionStatus');
      const row = findSession(profileId, id);
      sessions.set(id, { ...row, status, updatedAt: now() });
      return { ...sessions.get(id) };
    },
    deleteSession(profileId, id) { findSession(profileId, id); sessions.delete(id); },
    close() { for (const map of [users, profiles, credentials, authSessions, sessions]) map.clear(); },
  };
}

module.exports = { createMemoryRepository };
