import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { shiftDay } from '../lib/dates';
import { useCurrentDay } from './useCurrentDay';
import { translationError } from '../lib/i18n';
import catalog from '../../../shared/dashboard-modules.json';

export function useDashboard(view = 'overview') {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [busyResources, setBusyResources] = useState([]);
  const [resourceErrors, setResourceErrors] = useState({});
  const [error, setError] = useState('');
  const [wellnessPeriod, setWellnessPeriod] = useState(14);
  const [anchors, setAnchors] = useState({ overview: null, wellness: null });
  const period = view === 'wellness' ? wellnessPeriod : 1;
  const current = useRef(null);
  const generation = useRef(0);
  const dataRef = useRef(null);
  const timeZone = data?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const currentDay = useCurrentDay(timeZone);
  const minimumDay = shiftDay(currentDay, -90 + period);
  const anchorDate = view === 'plan' || !anchors[view] ? null : anchors[view] < minimumDay ? minimumDay : anchors[view] > currentDay ? currentDay : anchors[view];
  const endDay = anchorDate || currentDay;
  const visibleFrom = shiftDay(endDay, -(period - 1));
  const query = new URLSearchParams({ view, from: visibleFrom, to: endDay, timeZone }).toString();
  const queryRef = useRef(query);
  queryRef.current = query;

  const apply = useCallback(update => setData(previous => {
    const next = typeof update === 'function' ? update(previous) : update;
    dataRef.current = next;
    return next;
  }), []);

  const load = useCallback(async (force = false, importData = true, onlyResources, moduleId) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    const version = ++generation.current;
    const active = () => !controller.signal.aborted && version === generation.current;
    setLoading(true); setError(''); setResourceErrors({}); setSyncing(false); setBusyResources([]);
    const initial = !dataRef.current;
    const requested = Object.fromEntries(new URLSearchParams(queryRef.current));
    const readQuery = initial ? new URLSearchParams({ view: requested.view, period: requested.view === 'wellness' ? Math.round((Date.parse(requested.to) - Date.parse(requested.from)) / 86400000) + 1 : 1, timeZone: requested.timeZone }).toString() : queryRef.current;
    try {
      const result = await request(`/dashboard?${readQuery}`, { signal: controller.signal });
      if (!active()) return;
      apply(result); setLoading(false);
      if (!result.profile.hasGarminKey || !importData) return;
      const body = { view: result.view, from: result.measurements.range.from, to: result.measurements.range.to, timeZone: result.timeZone, force, ...(moduleId ? { moduleId } : {}) };
      const resources = Object.keys(result.requirements).filter(resource => (!onlyResources || onlyResources.includes(resource)) && (force || result.resourceStates[resource]?.state !== 'fresh'));
      setSyncing(resources.length > 0);
      // One coordinated queue: results reach their modules as each source completes.
      for (const resource of resources) {
        if (!active()) break;
        setBusyResources([resource]);
        try {
          const snapshot = await request('/garmin/sync', { method: 'POST', body: { ...body, resources: [resource] }, signal: controller.signal });
          if (!active()) break;
          apply(previous => previous?.profile.id === result.profile.id ? { ...previous, ...snapshot } : previous);
        } catch (failure) {
          if (!active()) break;
          setResourceErrors(previous => ({ ...previous, [resource]: failure }));
          if (failure.code === 'GARMIN_RATE_LIMIT') break;
        }
      }
    } catch (failure) { if (active()) setError(failure); }
    finally { if (active()) { setLoading(false); setSyncing(false); setBusyResources([]); } }
  }, [apply]);

  useEffect(() => {
    void load(false);
    return () => current.current?.abort();
  }, [load, query]);

  async function saveProfile(id, values) {
    const profile = await request('/profile', { method: 'PATCH', body: values });
    apply(previous => previous ? { ...previous, profile } : previous);
    await load(false, Object.hasOwn(values, 'apiKey'));
    return profile;
  }
  async function saveTheme(id, theme, darkMode) {
    const profile = await request('/profile/theme', { method: 'PATCH', body: { theme, darkMode } });
    apply(previous => previous ? { ...previous, profile } : previous);
    return profile;
  }
  async function saveLayout(layout) {
    const saved = await request('/dashboard/layout', { method: 'PUT', body: layout });
    apply(previous => ({ ...previous, layout: saved }));
    await load(false);
  }
  async function mutate(path, options, update) {
    const id = dataRef.current?.profile.id;
    if (!id) throw translationError('errors.PROFILE_REQUIRED');
    const result = await request(path, options);
    if (dataRef.current?.profile.id === id) apply(previous => previous ? update(previous, result) : previous);
    return result;
  }
  const createSession = values => mutate('/sessions', { method: 'POST', body: values }, (previous, session) => ({ ...previous, sessions: [...previous.sessions, session] }));
  const setSessionStatus = (id, status) => mutate(`/sessions/${id}`, { method: 'PATCH', body: { status } }, (previous, session) => ({ ...previous, sessions: previous.sessions.map(item => item.id === id ? session : item) }));
  const deleteSession = id => mutate(`/sessions/${id}`, { method: 'DELETE' }, previous => ({ ...previous, sessions: previous.sessions.filter(item => item.id !== id) }));
  const sameRange = data?.view === view && data?.measurements.range.from === visibleFrom && data?.measurements.range.to === endDay;
  const visibleData = !data || sameRange ? data : { ...data, measurements: { ...data.measurements, daily: [], details: {} }, trainingContext: null, activities: { sessions: [], complete: false }, resourceStates: {} };
  const failure = sameRange && (Object.values(resourceErrors)[0] || Object.values(data?.resourceStates || {}).find(state => state.errorCode)?.errorCode);

  return { view, data: visibleData, loading: loading || Boolean(data && !sameRange && !error), syncing, error, busyResources, resourceErrors: sameRange ? resourceErrors : {}, period,
    setPeriod: value => {
      setWellnessPeriod(value);
      setAnchors(previous => ({ ...previous, wellness: previous.wellness && shiftDay(previous.wellness, -(value - 1)) < shiftDay(currentDay, -89) ? shiftDay(currentDay, -90 + value) : previous.wellness }));
    }, endDay, visibleFrom, currentDay,
    setAnchorDate: value => setAnchors(previous => ({ ...previous, [view]: value >= currentDay ? null : value < minimumDay ? minimumDay : value })),
    shiftPeriod: direction => setAnchors(previous => {
      const next = shiftDay(anchorDate || currentDay, direction * period);
      return { ...previous, [view]: next >= currentDay ? null : next < minimumDay ? minimumDay : next };
    }),
    resetPeriod: () => setAnchors(previous => ({ ...previous, [view]: null })),
    reload: () => load(true),
    reloadModule: module => {
      const definition = catalog[module.type];
      return load(true, true, period === 1 && definition.dayResources || definition.resources, module.id);
    },
    garminConnection: { connecting: syncing, error: failure ? typeof failure === 'string' ? translationError(`errors.${failure}`) : failure : '' },
    profileId: data?.profile.id, saveProfile, saveTheme, saveLayout, createSession, setSessionStatus, deleteSession };
}
