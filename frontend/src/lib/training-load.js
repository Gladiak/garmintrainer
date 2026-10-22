import { shiftDay, weekDays } from './dates.js';

// Always render a complete calendar month, including days that have no sessions.
export function trainingMonth(day, offset = 0) {
  const [year, month] = day.split('-').map(Number);
  const from = new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
  const next = new Date(Date.UTC(year, month + offset, 1)).toISOString().slice(0, 10);
  const to = shiftDay(next, -1);
  return { from, to, gridStart: weekDays(from)[0], gridEnd: shiftDay(weekDays(to)[6], 1) };
}

// Each page contains two consecutive months; the default ends in the current month.
export function trainingMonthPair(day, page = 0) {
  const months = [trainingMonth(day, page * 2 - 1), trainingMonth(day, page * 2)];
  return { from: months[0].from, to: months[1].to, months };
}

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
