import { shiftDay } from './dates.js';
import { trainingMonth } from './training-load.js';

const templates = [
  { titleKey: 'demo.session.easyRun', sport: 'running', durationMinutes: 45, time: '07:30' },
  { titleKey: 'demo.session.ride', sport: 'cycling', durationMinutes: 140, time: '08:00' },
  { titleKey: 'demo.session.strength', sport: 'strength', durationMinutes: 60, time: '18:30' },
  { titleKey: 'demo.session.walk', sport: 'walking', durationMinutes: 30, time: '12:30' },
  { titleKey: 'demo.session.mobility', sport: 'mobility', durationMinutes: 25, time: '19:00' },
  { titleKey: 'demo.session.longRide', sport: 'cycling', durationMinutes: 210, time: '08:30' },
  { titleKey: 'demo.session.swim', sport: 'swimming', durationMinutes: 75, time: '17:00' },
];

// This plan is browser memory only. It never contains the profile's real sessions.
export function createDemoPlan(endDay) {
  const sessions = [];
  const from = trainingMonth(endDay, -5).from;
  const to = shiftDay(endDay, 21);
  for (let day = from, index = 0; day <= to; day = shiftDay(day, 1), index += 1) {
    if (day === endDay || ![0, 2, 4, 6].includes(index % 7)) continue;
    const template = templates[Math.floor(index / 2) % templates.length];
    sessions.push({
      ...template, id: `preview:${day}:scheduled`, date: day,
      status: day < endDay && index % 13 !== 0 ? 'completed' : 'planned',
      notesKey: 'demo.sessionNotes',
    });
    if (day < endDay && index % 23 === 0) {
      sessions.push({ ...templates[4], id: `preview:${day}:recovery`, date: day, status: 'completed', notesKey: 'demo.sessionNotes' });
    }
  }
  sessions.push(
    { ...templates[0], id: `preview:${endDay}:morning`, date: endDay, status: 'completed', notesKey: 'demo.sessionNotes' },
    { ...templates[2], id: `preview:${endDay}:evening`, date: endDay, status: 'planned', notesKey: 'demo.sessionNotes' },
  );
  return { sessions, nextId: 1 };
}

export function translateDemoSessions(sessions, translate) {
  return sessions.map((session) => ({
    ...session,
    title: session.titleKey ? translate(session.titleKey) : session.title,
    notes: session.notesKey ? translate(session.notesKey) : session.notes || '',
  }));
}

// Preview actions are handled here, without storage, network calls or API credentials.
export function demoPlanReducer(state, action) {
  switch (action.type) {
    case 'reset': return createDemoPlan(action.endDay);
    case 'create': {
      const { title, sport, date, time = '', durationMinutes, notes = '' } = action.values;
      const session = { id: `preview:custom:${state.nextId}`, title, sport, date, time, durationMinutes, notes, status: 'planned' };
      return { sessions: [...state.sessions, session], nextId: state.nextId + 1 };
    }
    case 'status':
      if (!['planned', 'completed'].includes(action.status)) return state;
      return { ...state, sessions: state.sessions.map((session) => session.id === action.id ? { ...session, status: action.status } : session) };
    case 'delete': return { ...state, sessions: state.sessions.filter((session) => session.id !== action.id) };
    default: return state;
  }
}
