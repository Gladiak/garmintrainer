import { ResponsiveLine } from '@nivo/line';
import { useMemo } from 'react';
import { ResponsiveBar } from '@nivo/bar';
import { Activity, Moon } from 'lucide-react';
import { METRICS } from '../lib/demo';
import { formatDay } from '../lib/dates';
import { useTheme } from './ThemeProvider';

const createChartTheme = (PALETTE) => ({
  text: { fontFamily: 'DM Sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 11, fill: PALETTE.textMuted },
  axis: { ticks: { line: { stroke: 'transparent' }, text: { fill: PALETTE.textMuted, fontSize: 11 } }, domain: { line: { stroke: 'transparent' } } },
  grid: { line: { stroke: PALETTE.border, strokeDasharray: '4 5' } },
  tooltip: { container: { padding: '10px 14px', borderRadius: 10, background: PALETTE.surface, boxShadow: '0 5px 24px color-mix(in srgb, var(--sand) 28%, transparent)', color: PALETTE.ink, fontSize: 12 } },
});
const formatAxisDate = (value) => new Intl.DateTimeFormat('it-IT', {
  day: '2-digit', month: 'short', timeZone: 'UTC',
}).format(new Date(value));

export function TrendChart({ daily, metric, days }) {
  const { palette, metricColors } = useTheme();
  const theme = useMemo(() => createChartTheme(palette), [palette]);
  const config = { ...METRICS[metric], color: metricColors[metric] };
  if (!daily.length) return <div className="chart-empty"><span className="empty-icon"><Activity size={23} /></span><strong>Il tuo andamento inizia da qui</strong><p>I dati compariranno dopo la prima importazione Garmin.</p></div>;
  const points = daily.slice(-days).map((item) => ({ x: item.date, y: item[metric] ?? null }));
  return <div className="trend-chart"><ResponsiveLine
    data={[{ id: config.label, data: points }]}
    margin={{ top: 20, right: 24, bottom: 38, left: 36 }}
    colors={[config.color]} theme={theme}
    xScale={{ type: 'time', format: '%Y-%m-%d', precision: 'day', useUTC: true }}
    xFormat={formatAxisDate}
    yScale={{ type: 'linear', min: 'auto', max: 'auto', stacked: false }}
    yFormat={(value) => `${value} ${config.unit}`}
    axisBottom={{ format: formatAxisDate, tickValues: `every ${days > 14 ? 7 : days > 7 ? 3 : 1} days`, tickPadding: 15 }}
    axisLeft={{ tickSize: 0, tickPadding: 13, tickValues: 4 }}
    enableGridX={false} gridYValues={4} lineWidth={2.5} curve="linear" enablePoints={false}
    enableArea areaOpacity={1}
    defs={[{ id: `area-${metric}`, type: 'linearGradient', colors: [{ offset: 0, color: config.color, opacity: 0.13 }, { offset: 100, color: config.color, opacity: 0.005 }] }]}
    fill={[{ match: '*', id: `area-${metric}` }]} useMesh animate={false}
    tooltip={({ point }) => <div className="chart-tooltip"><span>{point.data.xFormatted}</span><strong>{point.data.yFormatted}</strong><small>Dati di esempio</small></div>}
    role="img" ariaLabel={`${config.label}: andamento dimostrativo degli ultimi ${days} giorni, in ${config.unit}`} />
  </div>;
}

export function SleepChart({ daily }) {
  const { palette, sleepColors: SLEEP_COLORS } = useTheme();
  const theme = useMemo(() => createChartTheme(palette), [palette]);
  if (!daily.length) return <div className="sleep-empty"><Moon size={27} /><p>Una nuova prospettiva sulle tue notti.<br />In attesa dei primi dati del sonno.</p></div>;
  const data = daily.slice(-7).map((item) => ({ day: item.date, Profondo: item.deep / 60, Leggero: item.light / 60, REM: item.rem / 60 }));
  return <div className="sleep-chart"><ResponsiveBar data={data} keys={['Profondo', 'Leggero', 'REM']} indexBy="day"
    margin={{ top: 8, right: 4, bottom: 34, left: 28 }} theme={theme} padding={0.57} innerPadding={2}
    colors={({ id }) => SLEEP_COLORS[id]}
    borderRadius={3} enableLabel={false} axisTop={null} axisRight={null}
    axisLeft={{ tickValues: [0, 4, 8], tickSize: 0, tickPadding: 8, format: (value) => `${value}h` }}
    axisBottom={{ tickSize: 0, tickPadding: 13, format: (value) => formatDay(value, { weekday: 'short' }).slice(0, 3) }}
    gridYValues={[0, 4, 8]} maxValue={10} animate={false}
    tooltip={({ id, value, indexValue }) => <div className="chart-tooltip"><span>{formatDay(indexValue, { day: 'numeric', month: 'short' })} · esempio</span><strong>{id}: {Math.floor(value)} h {Math.round((value % 1) * 60)} min</strong></div>}
    role="img" ariaLabel="Durata dimostrativa del sonno negli ultimi sette giorni, suddivisa in sonno profondo, leggero e REM" /></div>;
}
