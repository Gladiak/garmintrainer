import { useId, useMemo } from 'react';
import { ResponsiveTimeRange } from '@nivo/calendar';
import { Activity, CalendarDays, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import { durationLabel, formatDay, shiftDay } from '../lib/dates';
import { trainingColors, trainingIntensity, trainingLoad, trainingMonthPair } from '../lib/training-load';
import { useTheme } from './ThemeProvider';

const LEGEND_KEYS = ['training.legendRest', 'training.legendUnderOne', 'training.legendOneTwo', 'training.legendTwoThree', 'training.legendThreePlus'];
const localMidnight = (day) => new Date(`${day}T00:00:00`);

export default function TrainingLoad({ sessions, endDay, range, page, onPageChange, loading, unavailable }) {
  const { t, locale } = useTranslation();
  const { palette, metricColors } = useTheme();
  const titleId = useId();
  const monthId = useId();
  const load = useMemo(() => trainingLoad(sessions, range, endDay), [sessions, range, endDay]);
  const colors = useMemo(() => trainingColors(metricColors.restingHeartRate, palette.mist), [metricColors.restingHeartRate, palette.mist]);
  const theme = useMemo(() => ({
    text: { fontFamily: 'DM Sans, sans-serif', fontSize: 11, fill: palette.textMuted },
    labels: { text: { fontSize: 9, fill: palette.textMuted } },
  }), [palette.textMuted]);
  const weekdays = Array.from({ length: 7 }, (_, index) => formatDay(shiftDay('2026-10-18', index), { weekday: 'short' }));
  const trainedDays = load.daily.filter((day) => day.minutes > 0).reverse();
  const ready = !loading && !unavailable;
  const number = (value) => new Intl.NumberFormat(locale).format(value);
  const rangeLabel = range.months.map((month) => formatDay(month.from, { month: 'short', year: 'numeric' })).join(' – ');

  return <section id="training-load" className="panel training-load-panel" aria-labelledby={titleId} aria-busy={loading}>
    <div className="panel-heading training-load-heading">
      <div><h2 id={titleId}>{t('training.title')}</h2><p>{t('training.subtitle')}</p></div>
    </div>

    <nav className="training-month-navigation" aria-label={t('training.navigation')}>
      <strong id={monthId} aria-live="polite" aria-atomic="true">{rangeLabel}</strong>
      <div className="training-month-controls">
        <button className="icon-button" type="button" aria-label={t('training.previousPair')} title={t('training.previousPair')} disabled={trainingMonthPair(endDay, page - 1).from < shiftDay(endDay, -365)} onClick={() => onPageChange(previous => previous - 1)}><ChevronLeft size={17} /></button>
        <button className="today-button" type="button" aria-pressed={page === 0} onClick={() => onPageChange(0)}>{t('training.currentPair')}</button>
        <button className="icon-button" type="button" aria-label={t('training.nextPair')} title={t('training.nextPair')} disabled={page >= 0} onClick={() => onPageChange(previous => previous + 1)}><ChevronRight size={17} /></button>
      </div>
    </nav>

    {ready ? <div className="training-month-pair" aria-labelledby={monthId}>
      {range.months.map((month) => <figure className="training-month" key={month.from}>
      <figcaption>{formatDay(month.from, { month: 'long', year: 'numeric' })}</figcaption>
      <div className="training-month-chart" aria-hidden="true"><ResponsiveTimeRange
        data={load.daily.filter((day) => day.day >= month.from && day.day <= month.to)} from={localMidnight(month.gridStart)} to={localMidnight(month.gridEnd)}
        margin={{ top: 4, right: 2, bottom: 4, left: 0 }}
        firstWeekday="monday" weekdays={weekdays} weekdayTicks={[0, 1, 2, 3, 4, 5, 6]} weekdayLegendOffset={26}
        monthLegend={() => ''} monthLegendOffset={0}
        daySpacing={2} dayRadius={2} dayBorderWidth={0}
        emptyColor={palette.surface} colorScale={(hours) => colors[trainingIntensity(hours)]}
        minValue={0} maxValue={3} theme={theme}
        valueFormat={(hours) => durationLabel(Math.round(hours * 60))}
        tooltip={({ day, value }) => <div className="chart-tooltip"><span>{formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' })}</span><strong>{value}</strong><small>{t(day > endDay ? 'training.futureDay' : 'training.tooltipSource')}</small></div>}
        role="presentation" />
      </div>
    </figure>)}
    </div> : <p className="training-load-empty" role="status">{t(loading ? 'common.loading' : 'training.unavailable')}</p>}

    <div className="training-load-summary">
      <div className="training-load-stat"><Clock3 size={16} aria-hidden="true" /><div><strong>{ready ? durationLabel(load.minutes) : '—'}</strong><span>{t('training.totalTime')}</span></div></div>
      <div className="training-load-stat"><CalendarDays size={16} aria-hidden="true" /><div><strong>{ready ? number(load.activeDays) : '—'}</strong><span>{t('training.activeDays')}</span></div></div>
      <div className="training-load-stat"><Activity size={16} aria-hidden="true" /><div><strong>{ready ? number(load.sessions) : '—'}</strong><span>{t('training.completedSessions')}</span></div></div>
    </div>

    {ready && <>
      <div className="training-load-footer"><ul className="training-load-legend" aria-label={t('training.legendLabel')}>
        {LEGEND_KEYS.map((key, index) => <li key={key}><i style={{ background: colors[index] }} aria-hidden="true" />{t(key)}</li>)}
      </ul><p>{t('training.source')}</p></div>
      {!load.activeDays && <p className="training-load-empty">{t('training.empty')}</p>}
      {trainedDays.length > 0 && <details className="training-load-details"><summary>{t('training.details')}</summary><div className="training-table-scroll"><table>
        <thead><tr><th scope="col">{t('session.date')}</th><th scope="col">{t('training.duration')}</th><th scope="col">{t('training.completedSessions')}</th></tr></thead>
        <tbody>{trainedDays.map((day) => <tr key={day.day}><th scope="row">{formatDay(day.day, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</th><td>{durationLabel(day.minutes)}</td><td>{number(day.sessions)}</td></tr>)}</tbody>
      </table></div></details>}
    </>}
  </section>;
}
