import { useCallback, useSyncExternalStore } from 'react';
import { today } from '../lib/dates';
import { observeDay } from '../lib/day-clock';

export function useCurrentDay(timeZone) {
  const subscribe = useCallback(notify => observeDay(timeZone, notify), [timeZone]);
  const snapshot = useCallback(() => today(timeZone), [timeZone]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
