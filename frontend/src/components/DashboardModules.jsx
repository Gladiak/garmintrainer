import { HeartPulse, Footprints, Wind, Droplet, Moon, BatteryCharging, Zap, RefreshCw } from 'lucide-react';
import catalog from '../../../shared/dashboard-modules.json';
import { durationLabel, formatDay } from '../lib/dates';
import { formatNumber } from '../lib/numbers';
import { messageText } from '../lib/i18n';
import { useTranslation } from '../hooks/useTranslation';
import { useTheme } from './ThemeProvider';
import { DailyRangeChart, DaySeriesChart, TrendChart, SleepChart, StressDayChart } from './Charts';
import TrainingLoad from './TrainingLoad';
import { HrvContext, PhysiologyChart, TrainingStatus } from './PhysiologyPanels';

const CARD_FIELDS = { 'heart-card': ['heartRateReferenceBpm', HeartPulse, 'bpm'], 'sleep-card': ['sleepMinutes', Moon, ''], 'battery-card': ['bodyBattery', BatteryCharging, '/100'], 'stress-card': ['stress', Zap, '/100'], 'hrv-card': ['hrv', HeartPulse, 'ms'], 'steps-card': ['steps', Footprints, ''], 'respiration-card': ['respirationAvg', Wind, 'br/min'], 'spo2-card': ['spo2Avg', Droplet, '%'] };

function ModuleContent({ module, dashboard, daily, day }) {
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

export default function DashboardModules({ dashboard }) {
  const { t, locale } = useTranslation();
  const { data, period, endDay, visibleFrom, busyResources, resourceErrors } = dashboard;
  const daily = data?.measurements.daily || [];
  const day = daily.find(item => item.date === endDay);
  const modules = data?.layout?.sections[dashboard.view] || [];
  return <div className={`dashboard-modules section-modules view-${dashboard.view}`}>
    {!modules.length && !dashboard.loading && <p className="module-note">{t('modules.emptyLayout')}</p>}
    {modules.map(module => {
      const definition = catalog[module.type];
      const resources = period === 1 && definition.dayResources || definition.resources;
      const states = resources.map(resource => data?.resourceStates?.[resource]).filter(Boolean);
      const busy = resources.some(resource => busyResources.includes(resource));
      const failure = resources.map(resource => resourceErrors[resource]).find(Boolean) || (definition.daily ? states.flatMap(state => state.errors || []).find(item => item.date === endDay)?.code : states.find(state => state.errorCode)?.errorCode);
      const times = states.map(state => definition.daily ? state.acquiredByDay?.[endDay] : state.lastSuccessAt).filter(Boolean);
      const acquired = times.length ? new Intl.DateTimeFormat(locale, { timeStyle: 'short', dateStyle: 'short', timeZone: data?.timeZone }).format(new Date(Math.min(...times.map(Date.parse)))) : null;
      const title = t(definition.label);
      const card = CARD_FIELDS[module.type];
      const Icon = card?.[1];
      const dataStates = states.map(state => definition.daily ? state.dataByDay?.[endDay] : state.dataState);
      const empty = card ? !Number.isFinite(day?.[card[0]]) : dataStates.length && dataStates.every(state => state !== 'available' && state !== 'cached');
      const retained = dataStates.includes('cached');
      return <article data-module-type={module.type} key={module.id} id={module.type === 'planner' && modules.find(item => item.type === 'planner').id === module.id ? 'plan' : undefined} className={`dashboard-module ${definition.size} ${card ? 'metric-card' : 'panel'}`} aria-busy={busy}>
        <div className={card ? 'metric-top' : 'panel-heading'}><div className="module-title">{Icon && <span className="metric-icon"><Icon size={18} /></span>}{card ? <span className="metric-label">{title}</span> : <h2>{title}</h2>}</div>
          {resources.length > 0 && <button className="icon-button module-refresh" title={t('modules.refresh', { name: title })} aria-label={t('modules.refresh', { name: title })} disabled={dashboard.loading || dashboard.syncing} onClick={() => dashboard.reloadModule(module)}><RefreshCw size={14} className={busy ? 'spin' : ''} /></button>}
        </div>
        {card ? <><div className="metric-body"><div className="metric-value">{Number.isFinite(day?.[card[0]]) ? card[0] === 'sleepMinutes' ? durationLabel(day[card[0]]) : formatNumber(day[card[0]], locale) : '—'}<span>{Number.isFinite(day?.[card[0]]) ? card[2] : ''}</span></div></div><p className="metric-caption">{formatDay(endDay, { day: 'numeric', month: 'short' })}{module.type === 'heart-card' && ` · ${t('metrics.heartHelp')}`}{module.type === 'stress-card' && ` · ${t('metrics.dailyAverage')}`}{module.type === 'hrv-card' && day?.hrvStatus && ` · ${t(`health.hrv.${day.hrvStatus}`)}`}{module.type === 'sleep-card' && Number.isFinite(day?.sleepScore) && ` · ${t('health.sleepScore')}: ${formatNumber(day.sleepScore, locale)}/100`}</p></> : <><p className="module-period">{visibleFrom === endDay ? formatDay(endDay, { day: 'numeric', month: 'long', year: 'numeric' }) : `${formatDay(visibleFrom, { day: 'numeric', month: 'short' })} – ${formatDay(endDay, { day: 'numeric', month: 'short', year: 'numeric' })}`}</p><div className="module-content"><ModuleContent module={module} dashboard={dashboard} daily={daily} day={day} /></div></>}
        {resources.length > 0 && <div className={`module-status ${failure ? 'has-error' : ''}`} role="status">{busy ? t('sync.working') : failure ? typeof failure === 'string' ? messageText({ key: `errors.${failure}` }) : messageText(failure) : empty ? t(data?.profile.hasGarminKey ? 'sync.noMeasurements' : 'sync.connect') : retained ? `${t('sync.cachedData')}${acquired ? ` · ${t('sync.updatedAt', { date: acquired })}` : ''}` : acquired ? t('sync.updatedAt', { date: acquired }) : t('metrics.waiting')}{!card && endDay === dashboard.currentDay && <span> · {t('modules.partialToday')}</span>}</div>}
      </article>;
    })}
  </div>;
}
