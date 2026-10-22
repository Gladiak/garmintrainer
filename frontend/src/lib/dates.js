export function today() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function shiftDay(day, offset) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function weekDays(day) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const monday = shiftDay(day, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => shiftDay(monday, index));
}

export function formatDay(day, options = {}) {
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', ...options }).format(new Date(`${day}T12:00:00Z`));
}

export function durationLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours} h${remainder ? ` ${remainder} min` : ''}` : `${minutes} min`;
}
