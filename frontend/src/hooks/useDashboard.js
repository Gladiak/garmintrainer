import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { prepareProfileAccess } from '../lib/garmin-access';
import { translationError } from '../lib/i18n';

export function useDashboard() {
  const [data, setData] = useState(null);
  const [profileId, setProfileId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [garminConnection, setGarminConnection] = useState({ connecting: false, error: '' });
  const controller = useRef(null);
  const selected = useRef(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const version = ++generation.current;
    setLoading(true);
    setError('');
    setGarminConnection({ connecting: false, error: '' });
    try {
      const result = await request('/dashboard', { signal: current.signal });
      if (current.signal.aborted || version !== generation.current) return;
      const id = result.profile.id;
      selected.current = id; setProfileId(id);
      setData(result);
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
  const reload = useCallback(() => load(), [load]);

  useEffect(() => {
    reload();
    return () => controller.current?.abort();
  }, [reload]);

  async function saveProfile(id, values) {
    const profile = await request('/profile', { method: 'PATCH', body: values });
    setData(previous => previous ? { ...previous, profile } : previous);
    // A provider failure is shown separately and must not undo a successful save.
    void load();
    return profile;
  }
  async function saveTheme(id, theme) {
    const profile = await request('/profile/theme', { method: 'PATCH', body: { theme } });
    setData(previous => previous ? { ...previous, profile } : previous);
    return profile;
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

  return { data, profileId, loading, error, garminConnection, reload, saveProfile, saveTheme, createSession, setSessionStatus, deleteSession };
}
