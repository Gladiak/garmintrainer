import { HeartPulse, Footprints, Wind, Droplet, Moon, BatteryCharging, Zap } from 'lucide-react';
import catalog from '../../../../shared/dashboard-modules.json';
import { durationLabel, formatDay } from '../../lib/dates';
import { formatNumber } from '../../lib/numbers';
import { useTranslation } from '../../hooks/useTranslation';
import { useTheme } from '../ThemeProvider';
import { DailyRangeChart, DaySeriesChart, TrendChart, SleepChart, StressDayChart } from '../Charts';
import TrainingLoad from '../TrainingLoad';
import { HrvContext, PhysiologyChart, TrainingStatus } from '../PhysiologyPanels';

const CARD_FIELDS = { 'heart-card': ['heartRateReferenceBpm', HeartPulse, 'bpm'], 'sleep-card': ['sleepMinutes', Moon, ''], 'battery-card': ['bodyBattery', BatteryCharging, '/100'], 'stress-card': ['stress', Zap, '/100'], 'hrv-card': ['hrv', HeartPulse, 'ms'], 'steps-card': ['steps', Footprints, ''], 'respiration-card': ['respirationAvg', Wind, 'br/min'], 'spo2-card': ['spo2Avg', Droplet, '%'] };

export function ModuleContent({ module, dashboard, daily, day }) {
  const { t, locale } = useTranslation();
  const { sleepColors } = useTheme();
  const { data, period, endDay, visibleFrom } = dashboard;
  const details = data?.measurements.details || {};
  switch (module.type) {
    case 'heart-rate':
    case 'body-battery': {
      const battery = module.type === 'body-battery';
      return period === 1 ? <DaySeriesChart series={details[battery ? 'body-battery-day' : 'heart-rate-day']} metric={battery ? 'bodyBattery' : 'heartRateReferenceBpm'} timeZone={data?.timeZone} /> : <><p className="module-note">{t('modules.rangeChart')}</p><DailyRangeChart daily={daily} metric={battery ? 'bodyBattery' : 'heartRateReferenceBpm'} /></>;
    }
    case 'hrv': return <><HrvContext day={day} />{period === 1 ? <><p className="module-note">{t('modules.nightlyAverage')}: {formatNumber(details['hrv-night']?.summary, locale)} ms</p><DaySeriesChart series={details['hrv-night']} metric="hrv" timeZone={data?.timeZone} /></> : <TrendChart daily={daily} metric="hrv" days={period} from={visibleFrom} to={endDay} />}</>;
    case 'sleep': return <><div className="sleep-summary"><strong>{Number.isFinite(day?.sleepMinutes) ? durationLabel(day.sleepMinutes) : '—'}</strong><span>{formatDay(endDay, { day: 'numeric', month: 'short' })}</span></div><SleepChart daily={daily} /><div className="sleep-legend">{Object.entries({ Profondo: 'sleep.deep', Leggero: 'sleep.light', REM: 'sleep.rem' }).map(([key, label]) => <span key={key}><i style={{ background: sleepColors[key] }} />{t(label)}</span>)}</div></>;
    case 'stress': return period === 1 ? <StressDayChart day={day} /> : <TrendChart daily={daily} metric="stress" days={period} from={visibleFrom} to={endDay} />;
    case 'activities': return <TrainingLoad sessions={data?.activities.sessions || []} range={{ from: visibleFrom, to: endDay }} throughDay={dashboard.currentDay} complete={data?.activities.complete} />;
    case 'respiration':
    case 'spo2': return <PhysiologyChart daily={daily} day={day} metric={module.type === 'respiration' ? 'respirationAvg' : 'spo2Avg'} period={period} from={visibleFrom} to={endDay} />;
    case 'training-status': return <TrainingStatus day={day} context={data?.trainingContext} endDay={endDay} />;
    default: return null;
  }
}

// One metadata registry is shared by the data renderer and the name-only editor.
export const componentLibrary = Object.fromEntries(Object.entries(catalog)
  .map(([type, definition]) => [type, { ...definition, card: CARD_FIELDS[type] }]));

export function componentName(type, t) {
  const definition = componentLibrary[type];
  return t(definition.size === 'compact' ? 'layout.summaryName' : 'layout.panelName', { name: t(definition.label) });
}
