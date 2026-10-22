import { today } from './dates.js';

// Check the calendar at minute boundaries: timezone offsets and DST need no 24h arithmetic.
export function observeDay(timeZone, notify) {
  let day = today(timeZone);
  let timer;
  function check() {
    clearTimeout(timer);
    const next = today(timeZone);
    if (next !== day) { day = next; notify(); }
    timer = setTimeout(check, 60_000 - Date.now() % 60_000 + 25);
  }
  function visible() { if (document.visibilityState === 'visible') check(); }
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
  document.addEventListener('visibilitychange', visible);
  check();
  return () => {
    clearTimeout(timer);
    window.removeEventListener('focus', check);
    window.removeEventListener('pageshow', check);
    document.removeEventListener('visibilitychange', visible);
  };
}
