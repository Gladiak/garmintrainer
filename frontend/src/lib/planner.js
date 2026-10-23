export function plannerWeek(sessions, activities, days) {
  const entries = [
    ...sessions.map(session => ({ ...session, source: 'local', key: `local:${session.id}` })),
    ...activities.map(session => ({ ...session, source: 'garmin', key: `garmin:${session.id}` })),
  ].filter(session => days.includes(session.date))
    .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`) || a.key.localeCompare(b.key));
  const minutes = items => items.reduce((sum, session) => sum + (Number.isFinite(session.durationMinutes) ? session.durationMinutes : 0), 0);
  return { entries, minutes: minutes(entries), days: days.map(date => {
    const sessions = entries.filter(session => session.date === date);
    return { date, sessions, minutes: minutes(sessions) };
  }) };
}
