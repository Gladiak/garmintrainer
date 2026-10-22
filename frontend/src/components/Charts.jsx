import { ResponsiveLine } from '@nivo/line';
import { ResponsiveBar } from '@nivo/bar';
import { ResponsiveBoxPlot } from '@nivo/boxplot';
import { useMemo } from 'react';
import { Activity, Moon } from 'lucide-react';
import { formatNumber } from '../lib/numbers';
import { METRICS } from '../lib/measurements';
import { durationLabel, formatDay } from '../lib/dates';
import { useTheme } from './ThemeProvider';
import { useTranslation } from '../hooks/useTranslation';

const createChartTheme = (palette, tickFontSize = 11) => ({
  text: { fontFamily: 'DM Sans, sans-serif', fontSize: 11, fill: palette.textMuted },
  axis: { ticks: { line: { stroke: 'transparent' }, text: { fill: palette.textMuted, fontSize: tickFontSize } }, domain: { line: { stroke: 'transparent' } } },
  grid: { line: { stroke: palette.border, strokeDasharray: '4 5' } },
  tooltip: { container: { padding: '10px 14px', borderRadius: 10, background: palette.surface, color: palette.ink, fontSize: 12 } },
});

export function ChartEmpty({ icon: Icon = Activity, title, description }) {
  const { t } = useTranslation();
  return <div className="chart-empty"><span className="empty-icon" aria-hidden="true"><Icon size={23} /></span><strong>{title ?? t('trend.emptyTitle')}</strong><p>{description ?? t('trend.emptyDescription')}</p></div>;
}

// Nivo supplies positions, but only the actual extrema are rendered: no synthetic quartiles.
function RangeGlyph({ boxPlot, ariaLabel }) {
  const { index, values } = boxPlot.coordinates;
  const cap = Math.min(10, boxPlot.width / 2);
  const label = ariaLabel?.(boxPlot);
  return <g stroke={boxPlot.color} strokeWidth={3} tabIndex={0} role="img" aria-label={label}>
    <title>{label}</title>
    <line x1={index} x2={index} y1={values[0]} y2={values[4]} />
    {[values[0], values[4]].map((y, i) => <line key={i} x1={index - cap} x2={index + cap} y1={y} y2={y} />)}
    <rect x={index - cap - 4} y={Math.min(values[0], values[4]) - 6} width={cap * 2 + 8} height={Math.abs(values[4] - values[0]) + 12} fill="transparent" stroke="none" />
  </g>;
}

export function DailyRangeChart({ daily, metric }) {
  const { t, locale } = useTranslation();
  const { palette, metricColors } = useTheme();
  const theme = useMemo(() => createChartTheme(palette), [palette]);
  const battery = metric === 'bodyBattery';
  const low = battery ? 'bodyBatteryMin' : 'heartRateMinBpm';
  const high = battery ? 'bodyBatteryMax' : 'heartRateMaxBpm';
  const unit = battery ? '/100' : 'bpm';
  const data = daily.flatMap(day => Number.isFinite(day[low]) && Number.isFinite(day[high])
    ? [{ day: day.date, value: day[low] }, { day: day.date, value: day[high] }] : []);
  if (!data.length) return <ChartEmpty />;
  const values = data.map(item => item.value);
  const min = battery ? 0 : Math.max(0, Math.min(...values) - 5);
  const max = battery ? 100 : Math.max(...values) + 5;
  const label = box => { const datum = box.data || box; return `${formatDay(datum.group, { day: 'numeric', month: 'short' })}: ${t('modules.minimum')} ${formatNumber(datum.extrema[0], locale)} ${unit}, ${t('modules.maximum')} ${formatNumber(datum.extrema[1], locale)} ${unit}`; };
  return <><div className="trend-chart"><ResponsiveBoxPlot data={data} groupBy="day" groups={daily.map(day => day.date)} value="value"
    quantiles={[0, 0.25, 0.5, 0.75, 1]} minValue={min} maxValue={max}
    margin={{ top: 18, right: 20, bottom: 44, left: 38 }} padding={0.35}
    colors={[metricColors[battery ? 'bodyBattery' : 'restingHeartRate']]} theme={theme}
    boxPlotComponent={RangeGlyph} boxPlotAriaLabel={label} isFocusable animate={false}
    axisBottom={{ format: day => formatDay(day, { day: 'numeric', month: 'short' }), tickValues: daily.filter((_, i) => i % (daily.length > 14 ? 5 : daily.length > 7 ? 2 : 1) === 0).map(day => day.date), tickPadding: 12 }}
    axisLeft={{ tickSize: 0, tickPadding: 8, tickValues: 4, format: value => formatNumber(value, locale) }} enableGridX={false} gridYValues={4}
    isInteractive={false} role="img" ariaLabel={t('modules.rangeChart')} /></div>
    <details className="module-details"><summary>{t('training.details')}</summary><table><thead><tr><th>{t('session.date')}</th><th>{t('modules.minimum')}</th><th>{t('modules.maximum')}</th></tr></thead><tbody>{daily.map(day => <tr key={day.date}><th>{formatDay(day.date, { day: 'numeric', month: 'short' })}</th><td>{formatNumber(day[low], locale)} {unit}</td><td>{formatNumber(day[high], locale)} {unit}</td></tr>)}</tbody></table></details></>;
}

export function DaySeriesChart({ series, metric, timeZone }) {
  const { locale, t } = useTranslation();
  const { palette, metricColors } = useTheme();
  const theme = useMemo(() => createChartTheme(palette, 10), [palette]);
  const points = series?.points || [];
  const keys = points.some(point => Number.isFinite(point.value)) ? ['value'] : ['min', 'max'];
  const unit = metric === 'heartRateReferenceBpm' ? 'bpm' : metric === 'hrv' ? 'ms' : '/100';
  if (!points.some(point => keys.some(key => Number.isFinite(point[key])))) return <ChartEmpty />;
  const formatTime = value => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(value));
  const formatFull = value => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(value));
  const data = keys.map(key => ({ id: key === 'value' ? t(metric === 'heartRateReferenceBpm' ? 'modules.heartRate' : METRICS[metric].label) : t(`modules.${key === 'min' ? 'minimum' : 'maximum'}`), data: points.map(point => ({ x: point.timestamp, y: point[key] ?? null })) }));
  const from = points[0].timestamp;
  const to = Math.max(from + 60000, points.at(-1).timestamp);
  return <div className="trend-chart"><ResponsiveLine data={data} margin={{ top: 15, right: 18, bottom: 42, left: 40 }}
    xScale={{ type: 'linear', min: from, max: to }} xFormat={formatFull}
    yScale={{ type: 'linear', min: metric === 'bodyBattery' ? 0 : 'auto', max: metric === 'bodyBattery' ? 100 : 'auto' }}
    yFormat={value => `${formatNumber(value, locale)} ${unit}`}
    axisBottom={{ format: formatTime, tickValues: 4, tickPadding: 12 }} axisLeft={{ tickSize: 0, tickPadding: 8, tickValues: 4, format: value => formatNumber(value, locale) }}
    colors={[metricColors[METRICS[metric].color], palette.textMuted]} theme={theme} lineWidth={metric === 'heartRateReferenceBpm' ? 1.5 : 2.5} curve="linear"
    enableGridX={false} gridYValues={4} enablePoints={points.length === 1} pointSize={6} useMesh animate={false}
    tooltip={({ point }) => <div className="chart-tooltip"><span>{point.data.xFormatted}</span><strong>{point.serieId}: {point.data.yFormatted}</strong></div>}
    role="img" ariaLabel={t('modules.dayReadings')} /></div>;
}

export function TrendChart({ daily, metric, days, from, to }) {
  const { t, locale } = useTranslation();
  const { palette, metricColors } = useTheme();
  const theme = useMemo(() => createChartTheme(palette), [palette]);
  const config = METRICS[metric];
  if (!daily.some(day => Number.isFinite(day[metric]))) return <ChartEmpty />;
  const formatDate = value => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(value));
  return <div className="trend-chart"><ResponsiveLine data={[{ id: t(config.label), data: daily.map(item => ({ x: item.date, y: item[metric] ?? null })) }]}
    margin={{ top: 20, right: 24, bottom: 38, left: 36 }} colors={[metricColors[config.color]]} theme={theme}
    xScale={{ type: 'time', format: '%Y-%m-%d', precision: 'day', useUTC: true, min: from, max: to }} xFormat={formatDate}
    yScale={{ type: 'linear', min: 'auto', max: 'auto', stacked: false }} yFormat={value => `${formatNumber(value, locale)} ${config.unit}`}
    axisBottom={{ format: formatDate, tickValues: `every ${days > 14 ? 7 : days > 7 ? 3 : 1} days`, tickPadding: 15 }} axisLeft={{ tickSize: 0, tickPadding: 13, tickValues: 4, format: value => formatNumber(value, locale) }}
    enableGridX={false} gridYValues={4} lineWidth={metric === 'heartRateReferenceBpm' ? 1.5 : 2.5} curve="linear" enablePoints={daily.length === 1} useMesh animate={false}
    tooltip={({ point }) => <div className="chart-tooltip"><span>{point.data.xFormatted}</span><strong>{point.data.yFormatted}</strong><small>{t('sync.source')}</small></div>}
    role="img" ariaLabel={t('trend.aria', { metric: t(config.label), count: days, unit: config.unit })} /></div>;
}

export function StressDayChart({ day }) {
  const { t, locale } = useTranslation();
  const { palette, metricColors } = useTheme();
  const theme = useMemo(() => createChartTheme(palette, 10), [palette]);
  const keys = ['stressRestSeconds', 'stressLowSeconds', 'stressMediumSeconds', 'stressHighSeconds'];
  const data = keys.filter(key => Number.isFinite(day?.[key])).map(key => ({ level: t(`modules.${key}`), minutes: day[key] / 60 }));
  return <><div className="stress-daily-summary"><div><span>{t('metrics.dailyAverage')}</span><strong>{formatNumber(day?.stress, locale)} <small>/100</small></strong></div><div><span>{t('modules.maximum')}</span><strong>{formatNumber(day?.stressMax, locale)} <small>/100</small></strong></div></div>
    {data.length ? <div className="stress-duration-chart"><ResponsiveBar data={data} keys={['minutes']} indexBy="level" layout="horizontal" margin={{ top: 12, right: 35, bottom: 32, left: 105 }}
      theme={theme} colors={[metricColors.bodyBattery]} padding={0.4} enableLabel={false} axisBottom={{ tickSize: 0, tickValues: 4, format: value => t('common.minutes', { count: formatNumber(value, locale) }) }} axisLeft={{ tickSize: 0, tickPadding: 8 }}
      enableGridY={false} enableGridX animate={false} tooltip={({ indexValue, value }) => <div className="chart-tooltip"><span>{indexValue}</span><strong>{durationLabel(value)}</strong></div>} role="img" ariaLabel={t('modules.stressBreakdown')} /></div> : <p className="module-note">{t('modules.noDurations')}</p>}
    <p className="module-note">{t('modules.stressAggregates')}</p></>;
}

export function SleepChart({ daily }) {
  const { t, locale } = useTranslation();
  const { palette, sleepColors } = useTheme();
  const theme = useMemo(() => createChartTheme(palette), [palette]);
  if (!daily.some(day => ['deep', 'light', 'rem'].some(key => Number.isFinite(day[key])))) return <ChartEmpty icon={Moon} title={t('sleep.emptyTitle')} description={t('sleep.emptyDescription')} />;
  const data = daily.map(item => ({ day: item.date, Profondo: Number.isFinite(item.deep) ? item.deep / 60 : undefined, Leggero: Number.isFinite(item.light) ? item.light / 60 : undefined, REM: Number.isFinite(item.rem) ? item.rem / 60 : undefined }));
  const maxHours = Math.max(10, ...data.map(day => Math.ceil((day.Profondo || 0) + (day.Leggero || 0) + (day.REM || 0))));
  return <div className="sleep-chart"><ResponsiveBar data={data} keys={['Profondo', 'Leggero', 'REM']} indexBy="day" margin={{ top: 8, right: 4, bottom: 34, left: 28 }} theme={theme} padding={daily.length === 1 ? 0.8 : 0.4} innerPadding={2}
    colors={({ id }) => sleepColors[id]} borderRadius={3} enableLabel={false} axisTop={null} axisRight={null}
    axisLeft={{ tickValues: 4, tickSize: 0, tickPadding: 8, format: value => t('common.hours', { count: formatNumber(value, locale) }) }}
    axisBottom={{ tickSize: 0, tickPadding: 13, tickValues: daily.filter((_, i) => i % (daily.length > 14 ? 5 : daily.length > 7 ? 2 : 1) === 0).map(day => day.date), format: value => formatDay(value, { day: 'numeric', month: 'short' }) }} gridYValues={4} maxValue={maxHours} animate={false}
    tooltip={({ id, value, indexValue }) => <div className="chart-tooltip"><span>{formatDay(indexValue, { day: 'numeric', month: 'short' })}</span><strong>{t({ Profondo: 'sleep.deep', Leggero: 'sleep.light', REM: 'sleep.rem' }[id])}: {durationLabel(value * 60)}</strong></div>}
    role="img" ariaLabel={t('sleep.aria')} /></div>;
}
