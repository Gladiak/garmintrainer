import { shiftDay } from './dates.js';

// Comparisons describe measured data only; missing days never count as rest or zero.
export function recoveryMetrics(context, endDay) {
  const daily = context?.daily || [];
  const sessions = (context?.sessions || []).filter(session => session.status === 'completed' && session.date >= shiftDay(endDay, -27) && session.date <= endDay);
  const mean = (field, from, to) => {
    const values = daily.filter(day => day.date >= from && day.date <= to && Number.isFinite(day[field])).map(day => day[field]);
    return { value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, count: values.length };
  };
  const week = offset => {
    const to = shiftDay(endDay, offset);
    const from = shiftDay(to, -6);
    const activities = sessions.filter(session => session.date >= from && session.date <= to);
    const complete = Array.from({ length: 7 }, (_, index) => shiftDay(from, index)).every(date => context?.completeByDay?.[date] === true);
    const loads = activities.filter(session => Number.isFinite(session.activityTrainingLoad));
    const durations = activities.filter(session => Number.isFinite(session.durationMinutes));
    return { from, to, complete, count: activities.length, loadCount: loads.length,
      load: loads.length || complete && !activities.length ? loads.reduce((sum, session) => sum + session.activityTrainingLoad, 0) : null,
      minutes: durations.length || complete && !activities.length ? durations.reduce((sum, session) => sum + session.durationMinutes, 0) : null,
      loadComplete: complete && loads.length === activities.length,
    };
  };
  const current = week(0), previous = week(-7);
  const vo2 = sessions.filter(session => Number.isFinite(session.vo2Max) && session.vo2Max > 0)
    .sort((a, b) => `${b.date} ${b.time || ''} ${b.id}`.localeCompare(`${a.date} ${a.time || ''} ${a.id}`));
  const latestVo2 = vo2[0] || null;
  // Keep sports separate and compare distinct dates, so duplicate readings do not imply a trend.
  const previousVo2 = latestVo2?.activityType ? vo2.find(session => session.activityType === latestVo2.activityType && session.date < latestVo2.date) || null : null;
  return {
    sleep: mean('sleepScore', shiftDay(endDay, -6), endDay),
    heart: mean('heartRateReferenceBpm', shiftDay(endDay, -7), shiftDay(endDay, -1)),
    current, previous,
    loadChange: current.loadComplete && previous.loadComplete ? current.load - previous.load : null,
    latestVo2, previousVo2,
  };
}
