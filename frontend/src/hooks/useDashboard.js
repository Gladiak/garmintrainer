import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { today, shiftDay } from '../lib/dates';
import { trainingMonthPair } from '../lib/training-load';
import { translationError } from '../lib/i18n';

export function useDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [period, setPeriod] = useState(14);
  const [wellnessEnd, setWellnessEnd] = useState(null);
  const [activityPage, setActivityPage] = useState(0);
  const current = useRef(null);
  const generation = useRef(0);
  const dataRef = useRef(null);
  const currentDay = today(data?.timeZone);
  const endDay = wellnessEnd || currentDay;
  const visibleFrom = shiftDay(endDay, -(period - 1));
  const from = shiftDay(endDay, -(Math.max(period, 12) - 1));
  const activityRange = trainingMonthPair(currentDay, activityPage);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const query = new URLSearchParams({ from, to: endDay, activityFrom: activityRange.from, activityTo: activityRange.to, timeZone }).toString();
  const queryRef = useRef(query);
  queryRef.current = query;

  const load = useCallback(async (force = false, importData = true) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    const version = ++generation.current;
    const active = () => !controller.signal.aborted && version === generation.current;
    setLoading(true); setError(''); setSyncError(''); setSyncing(false);
    const params = queryRef.current;
    const initial = !dataRef.current;
    const requested = Object.fromEntries(new URLSearchParams(params));
    const readQuery = initial ? new URLSearchParams({ timeZone: requested.timeZone }).toString() : params;
    try {
      const result = await request(`/dashboard?${readQuery}`, { signal: controller.signal });
      if (!active()) return;
      dataRef.current = result; setData(result); setLoading(false);
      if (!result.profile.hasGarminKey || !importData) return;
      setSyncing(true);
      const body = initial ? { from: result.measurements.range.from, to: result.measurements.range.to,
        activityFrom: result.activities.range.from, activityTo: result.activities.range.to, timeZone: result.timeZone, force }
        : { ...requested, force };
      try {
        const snapshot = await request('/garmin/sync', { method: 'POST', body, signal: controller.signal });
        if (active()) {
          setData(previous => {
            if (previous?.profile.id !== result.profile.id) return previous;
            const next = { ...previous, ...snapshot };
            dataRef.current = next;
            return next;
          });
        }
      } catch (failure) { if (active()) setSyncError(failure); }
    } catch (failure) { if (active()) setError(failure); }
    finally { if (active()) { setLoading(false); setSyncing(false); } }
  }, []);

  useEffect(() => {
    void load(false);
    return () => current.current?.abort();
  }, [load, query]);

  const reload = useCallback(() => load(true), [load]);

  async function saveProfile(id, values) {
    const profile = await request('/profile', { method: 'PATCH', body: values });
    setData(previous => previous ? { ...previous, profile } : previous);
    await load(false, Object.hasOwn(values, 'apiKey'));
    return profile;
  }
  async function saveTheme(id, theme) {
    const profile = await request('/profile/theme', { method: 'PATCH', body: { theme } });
    setData(previous => previous ? { ...previous, profile } : previous);
    return profile;
  }
  async function mutate(path, options, apply) {
    const id = dataRef.current?.profile.id;
    if (!id) throw translationError('errors.PROFILE_REQUIRED');
    const result = await request(path, options);
    if (dataRef.current?.profile.id === id) setData(previous => previous ? apply(previous, result) : previous);
    return result;
  }
  const createSession = values => mutate('/sessions', { method: 'POST', body: values }, (previous, session) => ({ ...previous, sessions: [...previous.sessions, session] }));
  const setSessionStatus = (id, status) => mutate(`/sessions/${id}`, { method: 'PATCH', body: { status } }, (previous, session) => ({ ...previous, sessions: previous.sessions.map(item => item.id === id ? session : item) }));
  const deleteSession = id => mutate(`/sessions/${id}`, { method: 'DELETE' }, previous => ({ ...previous, sessions: previous.sessions.filter(item => item.id !== id) }));
  const resourceError = Object.values(data?.measurements.sync || {}).find(state => state.errorCode)?.errorCode || data?.activities.errorCode;

  return { data, loading, syncing, error, syncError, period,
    setPeriod: value => {
      setPeriod(value);
      setWellnessEnd(previous => previous && shiftDay(previous, -(Math.max(value, 12) - 1)) < shiftDay(currentDay, -89)
        ? shiftDay(currentDay, -90 + Math.max(value, 12)) : previous);
    }, endDay, visibleFrom,
    activityRange, activityPage, setActivityPage, currentDay,
    shiftPeriod: direction => setWellnessEnd(previous => shiftDay(previous || currentDay, direction * period)),
    resetPeriod: () => setWellnessEnd(null),
    garminConnection: { connecting: syncing, error: syncError || (resourceError ? translationError(`errors.${resourceError}`) : '') },
    profileId: data?.profile.id, reload, saveProfile, saveTheme, createSession, setSessionStatus, deleteSession };
}
