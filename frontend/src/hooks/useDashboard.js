import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { prepareProfileAccess } from '../lib/garmin-access';
import { translationError } from '../lib/i18n';

const SELECTION_KEY = 'garmintrainer.profileId';
function rememberProfile(id) {
  try { if (id) localStorage.setItem(SELECTION_KEY, id); else localStorage.removeItem(SELECTION_KEY); } catch { /* Optional in private browsing. */ }
}

export function useDashboard() {
  const [data, setData] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [garminConnection, setGarminConnection] = useState({ connecting: false, error: '' });
  const controller = useRef(null);
  const selected = useRef(null);
  const generation = useRef(0);
  const initialized = useRef(false);

  const load = useCallback(async (requestedId, discover = false) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const version = ++generation.current;
    setLoading(true);
    setError('');
    setGarminConnection({ connecting: false, error: '' });
    try {
      let id = requestedId;
      if (discover) {
        const result = await request('/profiles', { signal: current.signal });
        if (current.signal.aborted) return;
        setProfiles(result.profiles);
        let saved;
        try { saved = localStorage.getItem(SELECTION_KEY); } catch { /* Optional storage. */ }
        id = result.profiles.some((item) => item.id === saved) ? saved : result.profiles[0]?.id || null;
      }
      selected.current = id; setProfileId(id); rememberProfile(id);
      setData((previous) => previous?.profile?.id === id ? previous : null);
      const result = await request('/dashboard', { signal: current.signal, profileId: id });
      if (current.signal.aborted || version !== generation.current) return;
      initialized.current = true;
      setProfiles(result.profiles); setData(result);
      void prepareProfileAccess({
        profileId: id, status: result.garmin, signal: current.signal,
        isCurrent: () => selected.current === id && version === generation.current,
        onChange: ({ status, ...connection }) => {
          setGarminConnection(connection);
          if (status) setData((previous) => previous?.profile?.id === id ? { ...previous, garmin: status } : previous);
        },
      });
    } catch (failure) {
      if (!current.signal.aborted && version === generation.current) setError(failure);
    } finally {
      if (!current.signal.aborted && version === generation.current) setLoading(false);
    }
  }, []);
  const reload = useCallback(() => load(selected.current, !initialized.current), [load]);

  useEffect(() => {
    reload();
    return () => controller.current?.abort();
  }, [reload]);

  async function selectProfile(id) {
    selected.current = id; setProfileId(id); setData(null);
    await load(id);
  }
  async function saveProfile(id, values) {
    const profile = await request(id ? `/profiles/${id}` : '/profiles', { method: id ? 'PATCH' : 'POST', body: values });
    setProfiles((previous) => id ? previous.map((item) => item.id === id ? profile : item) : [...previous, profile]);
    if (!id) await selectProfile(profile.id);
    else await load(selected.current);
    return profile;
  }
  async function saveTheme(id, theme) {
    const profile = await request(`/profiles/${id}/theme`, { method: 'PATCH', body: { theme } });
    setProfiles((previous) => previous.map((item) => item.id === id ? profile : item));
    setData((previous) => previous?.profile?.id === id ? { ...previous, profile } : previous);
    return profile;
  }
  async function deleteProfile(id) {
    await request(`/profiles/${id}`, { method: 'DELETE' });
    try { localStorage.removeItem(`garmintrainer.profileTheme:${id}`); } catch { /* Optional browser cache. */ }
    try { localStorage.removeItem(`garmintrainer.profileLanguage:${id}`); } catch { /* Optional browser cache. */ }
    const remaining = profiles.filter((item) => item.id !== id);
    setProfiles(remaining);
    await selectProfile(selected.current === id ? remaining[0]?.id || null : selected.current);
  }
  async function mutate(path, options, apply) {
    const id = selected.current;
    const version = generation.current;
    if (!id) throw translationError('errors.PROFILE_REQUIRED');
    const result = await request(path, { ...options, profileId: id });
    if (selected.current === id && generation.current === version) {
      setData((previous) => previous ? apply(previous, result) : previous);
    }
    return result;
  }
  const createSession = (values) => mutate('/sessions', { method: 'POST', body: values }, (previous, session) => ({ ...previous, sessions: [...previous.sessions, session] }));
  const setSessionStatus = (id, status) => mutate(`/sessions/${id}`, { method: 'PATCH', body: { status } }, (previous, session) => ({ ...previous, sessions: previous.sessions.map((item) => item.id === id ? session : item) }));
  const deleteSession = (id) => mutate(`/sessions/${id}`, { method: 'DELETE' }, (previous) => ({ ...previous, sessions: previous.sessions.filter((item) => item.id !== id) }));

  return { data, profiles, profileId, loading, error, garminConnection, reload, selectProfile, saveProfile, saveTheme, deleteProfile, createSession, setSessionStatus, deleteSession };
}
