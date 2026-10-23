import { useMemo } from 'react';
import { ResponsiveTimeRange } from '@nivo/calendar';
import { Activity, CalendarDays, Clock3 } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import { durationLabel, formatDay, shiftDay, weekDays } from '../lib/dates';
import { formatNumber } from '../lib/numbers';
import { trainingColors, trainingIntensity, trainingLoad } from '../lib/training-load';
import { useTheme } from './ThemeProvider';
import { activityLabel } from '../lib/activities';
import { ChartEmpty } from './Charts';

const LEGEND_KEYS = ['training.legendRest', 'training.legendUnderOne', 'training.legendOneTwo', 'training.legendTwoThree', 'training.legendThreePlus'];
const localMidnight = day => new Date(`${day}T00:00:00`);

function activityFacts(session, t, locale) {
  return [session.time, durationLabel(session.durationMinutes),
    Number.isFinite(session.distanceMeters) ? `${formatNumber(session.distanceMeters / 1000, locale)} km` : null,
    Number.isFinite(session.averageHeartRateBpm) ? `${t('activity.averageHR')}: ${formatNumber(session.averageHeartRateBpm, locale)} bpm` : null,
    Number.isFinite(session.caloriesKcal) ? `${formatNumber(session.caloriesKcal, locale)} kcal` : null,
    Number.isFinite(session.elevationGainMeters) ? `${t('activity.elevationGain')}: ${formatNumber(session.elevationGainMeters, locale)} m` : null,
    Number.isFinite(session.aerobicTrainingEffect) ? `${t('training.aerobicEffect')}: ${formatNumber(session.aerobicTrainingEffect, locale)}/5` : null,
    Number.isFinite(session.anaerobicTrainingEffect) ? `${t('training.anaerobicEffect')}: ${formatNumber(session.anaerobicTrainingEffect, locale)}/5` : null,
    Number.isFinite(session.vo2Max) ? `VO₂ max: ${formatNumber(session.vo2Max, locale)} ml/kg/min` : null,
  ].filter(Boolean).join(' · ');
}

function ActivityTooltip({ day, value, sessions }) {
  const { t, locale } = useTranslation();
  const activities = sessions.filter(session => session.date === day);
  return <div className="chart-tooltip activity-tooltip"><span>{formatDay(day, { day: 'numeric', month: 'long' })}</span><strong>{value}</strong>
    {activities.slice(0, 5).map(session => <div key={session.id}><b>{activityLabel(session, t)}</b><small>{activityFacts(session, t, locale)}</small></div>)}
    {activities.length > 5 && <small>{t('activity.moreActivities', { count: activities.length - 5 })}</small>}
    {!activities.length && <small>{t('training.empty')}</small>}
  </div>;
}

export default function TrainingLoad({ sessions, range, throughDay, complete }) {
  const { t, locale } = useTranslation();
  const { palette, metricColors } = useTheme();
  const load = useMemo(() => trainingLoad(sessions, range, throughDay), [sessions, range.from, range.to, throughDay]);
  const ordered = useMemo(() => sessions.filter(session => session.date >= range.from && session.date <= range.to)
    .sort((a, b) => `${b.date} ${b.time || ''}`.localeCompare(`${a.date} ${a.time || ''}`) || b.id.localeCompare(a.id)), [sessions, range.from, range.to]);
  const distance = ordered.filter(session => Number.isFinite(session.distanceMeters));
  const calories = ordered.filter(session => Number.isFinite(session.caloriesKcal));
  const colors = trainingColors(metricColors.restingHeartRate, palette.mist);
  const theme = { text: { fontFamily: 'DM Sans, sans-serif', fontSize: 9, fill: palette.textMuted }, labels: { text: { fontSize: 8, fill: palette.textMuted } } };
  if (!complete) return <ChartEmpty description={t('training.unavailable')} />;
  return <>
    {range.from !== range.to && <div className="activity-range-chart"><ResponsiveTimeRange square={false} data={load.daily}
      from={localMidnight(weekDays(range.from)[0])} to={localMidnight(shiftDay(weekDays(range.to)[6], 1))}
      margin={{ top: 12, right: 4, bottom: 8, left: 30 }} firstWeekday="monday" weekdays={Array.from({ length: 7 }, (_, index) => formatDay(shiftDay('2026-10-19', index), { weekday: 'short' }))}
      weekdayTicks={[0, 1, 2, 3, 4, 5, 6]} weekdayLegendOffset={25} monthLegend={() => ''}
      daySpacing={3} dayRadius={3} emptyColor={palette.surface} colorScale={hours => colors[trainingIntensity(hours)]}
      minValue={0} maxValue={3} theme={theme} valueFormat={hours => durationLabel(hours * 60)}
      tooltip={({ day, value }) => <ActivityTooltip day={day} value={value} sessions={ordered} />} role="img" ariaLabel={t('training.legendLabel')} /></div>}
    <div className="training-load-summary">{[[Clock3, durationLabel(load.minutes), 'training.totalTime'], [CalendarDays, load.activeDays, 'training.activeDays'], [Activity, load.sessions, 'training.completedSessions']].map(([Icon, value, label]) => <div className="training-load-stat" key={label}><Icon size={16} /><div><strong>{typeof value === 'number' ? formatNumber(value, locale) : value}</strong><span>{t(label)}</span></div></div>)}</div>
    {range.from !== range.to && <ul className="training-load-legend">{LEGEND_KEYS.map((key, index) => <li key={key}><i style={{ background: colors[index] }} />{t(key)}</li>)}</ul>}
    {ordered.length > 1 && (distance.length > 0 || calories.length > 0) && <>
      <dl className="physiology-values activity-totals">
        <div><dt>{t('activity.distance')}</dt><dd>{distance.length ? `${formatNumber(distance.reduce((sum, session) => sum + session.distanceMeters, 0) / 1000, locale)} km` : '—'}</dd></div>
        <div><dt>{t('training.calories')}</dt><dd>{calories.length ? `${formatNumber(calories.reduce((sum, session) => sum + session.caloriesKcal, 0), locale)} kcal` : '—'}</dd></div>
      </dl>
      <p className="module-note">{t('training.availableActivityTotals')}</p>
    </>}
    {!load.activeDays ? <p className="module-note">{t('training.empty')}</p> : <div className="module-details activity-table"><table><thead><tr><th>{t('session.date')}</th><th>{t('activity.type')}</th><th>{t('activity.detail')}</th></tr></thead><tbody>{ordered.map(session => <tr key={session.id}><th>{formatDay(session.date, { day: 'numeric', month: 'short' })}</th><td>{activityLabel(session, t)}</td><td className="activity-detail-cell">{activityFacts(session, t, locale)}</td></tr>)}</tbody></table></div>}
  </>;
}
