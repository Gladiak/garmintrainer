import { shiftDay } from './dates.js';

export function trainingLoad(sessions, range, throughDay = range.to) {
  const totals = new Map();
  for (const session of sessions) {
    if (typeof session.date !== 'string') continue;
    if (session.status !== 'completed' || session.date < range.from || session.date > range.to || session.date > throughDay) continue;
    if (!Number.isFinite(session.durationMinutes) || session.durationMinutes <= 0) continue;
    const previous = totals.get(session.date) || { minutes: 0, sessions: 0 };
    totals.set(session.date, { minutes: previous.minutes + session.durationMinutes, sessions: previous.sessions + 1 });
  }
  const daily = [];
  for (let day = range.from; day <= range.to; day = shiftDay(day, 1)) {
    const total = totals.get(day) || { minutes: 0, sessions: 0 };
    daily.push({ day, value: total.minutes / 60, ...total });
  }
  return {
    daily,
    minutes: daily.reduce((sum, day) => sum + day.minutes, 0),
    sessions: daily.reduce((sum, day) => sum + day.sessions, 0),
    activeDays: daily.filter((day) => day.minutes > 0).length,
  };
}

// Fixed hour bands keep the same daily load comparable across periods and profiles.
export function trainingIntensity(hours) {
  if (hours <= 0) return 0;
  if (hours < 1) return 1;
  if (hours < 2) return 2;
  if (hours < 3) return 3;
  return 4;
}

export function trainingColors(accent, empty) {
  const channels = accent.slice(1).match(/../g).map((value) => parseInt(value, 16));
  const shade = (amount) => `#${channels.map((value) => Math.round(255 + (value - 255) * amount).toString(16).padStart(2, '0')).join('')}`;
  return [empty, shade(0.25), shade(0.50), shade(0.75), accent];
}
