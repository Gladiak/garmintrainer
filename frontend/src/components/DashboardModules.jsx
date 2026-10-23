import { RefreshCw } from 'lucide-react';
import { useRef } from 'react';
import { durationLabel, formatDay } from '../lib/dates';
import { formatNumber } from '../lib/numbers';
import { messageText } from '../lib/i18n';
import { useTranslation } from '../hooks/useTranslation';
import { useGridColumns } from '../hooks/useGridColumns';
import { responsiveModules, moduleGridStyle } from '../../../shared/dashboard-grid.mjs';
import { componentLibrary, ModuleContent } from './dashboard/ModuleLibrary';

export default function DashboardModules({ dashboard }) {
  const { t, locale } = useTranslation();
  const { data, period, endDay, visibleFrom, busyResources, resourceErrors } = dashboard;
  const daily = data?.measurements.daily || [];
  const day = daily.find(item => item.date === endDay);
  const grid = useRef(null);
  const columns = useGridColumns(grid);
  const modules = responsiveModules(data?.layout?.sections[dashboard.view] || [], columns);
  return <div ref={grid} className={`dashboard-modules section-modules configured-grid view-${dashboard.view}`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
    {!modules.length && !dashboard.loading && <p className="module-note">{t('modules.emptyLayout')}</p>}
    {modules.map(module => {
      const definition = componentLibrary[module.type];
      const resources = period === 1 && definition.dayResources || definition.resources;
      const states = resources.map(resource => data?.resourceStates?.[resource]).filter(Boolean);
      const busy = resources.some(resource => busyResources.includes(resource));
      const failure = resources.map(resource => resourceErrors[resource]).find(Boolean) || (definition.daily ? states.flatMap(state => state.errors || []).find(item => item.date === endDay)?.code : states.find(state => state.errorCode)?.errorCode);
      const times = states.map(state => definition.daily ? state.acquiredByDay?.[endDay] : state.lastSuccessAt).filter(Boolean);
      const acquired = times.length ? new Intl.DateTimeFormat(locale, { timeStyle: 'short', dateStyle: 'short', timeZone: data?.timeZone }).format(new Date(Math.min(...times.map(Date.parse)))) : null;
      const title = t(definition.label);
      const card = definition.card;
      const Icon = card?.[1];
      const dataStates = states.map(state => definition.daily ? state.dataByDay?.[endDay] : state.dataState);
      const empty = card ? !Number.isFinite(day?.[card[0]]) : dataStates.length && dataStates.every(state => state !== 'available' && state !== 'cached');
      const retained = dataStates.includes('cached');
      return <article data-module-type={module.type} key={module.id} style={moduleGridStyle(module)} id={module.type === 'planner' && modules.find(item => item.type === 'planner').id === module.id ? 'plan' : undefined} className={`dashboard-module ${definition.size} ${card ? 'metric-card' : 'panel'}`} aria-busy={busy}>
        <div className={card ? 'metric-top' : 'panel-heading'}><div className="module-title">{Icon && <span className="metric-icon"><Icon size={18} /></span>}{card ? <span className="metric-label">{title}</span> : <h2>{title}</h2>}</div>
          {resources.length > 0 && <button className="icon-button module-refresh" title={t('modules.refresh', { name: title })} aria-label={t('modules.refresh', { name: title })} disabled={dashboard.loading || dashboard.syncing} onClick={() => dashboard.reloadModule(module)}><RefreshCw size={14} className={busy ? 'spin' : ''} /></button>}
        </div>
        {card ? <><div className="metric-body"><div className="metric-value">{Number.isFinite(day?.[card[0]]) ? card[0] === 'sleepMinutes' ? durationLabel(day[card[0]]) : formatNumber(day[card[0]], locale) : '—'}<span>{Number.isFinite(day?.[card[0]]) ? card[2] : ''}</span></div></div><p className="metric-caption">{formatDay(endDay, { day: 'numeric', month: 'short' })}{module.type === 'heart-card' && ` · ${t('metrics.heartHelp')}`}{module.type === 'stress-card' && ` · ${t('metrics.dailyAverage')}`}{module.type === 'hrv-card' && day?.hrvStatus && ` · ${t(`health.hrv.${day.hrvStatus}`)}`}{module.type === 'sleep-card' && Number.isFinite(day?.sleepScore) && ` · ${t('health.sleepScore')}: ${formatNumber(day.sleepScore, locale)}/100`}</p></> : <><p className="module-period">{visibleFrom === endDay ? formatDay(endDay, { day: 'numeric', month: 'long', year: 'numeric' }) : `${formatDay(visibleFrom, { day: 'numeric', month: 'short' })} – ${formatDay(endDay, { day: 'numeric', month: 'short', year: 'numeric' })}`}</p><div className="module-content"><ModuleContent module={module} dashboard={dashboard} daily={daily} day={day} /></div></>}
        {resources.length > 0 && <div className={`module-status ${failure ? 'has-error' : ''}`} role="status">{busy ? t('sync.working') : failure ? typeof failure === 'string' ? messageText({ key: `errors.${failure}` }) : messageText(failure) : empty ? t(data?.profile.hasGarminKey ? 'sync.noMeasurements' : 'sync.connect') : retained ? `${t('sync.cachedData')}${acquired ? ` · ${t('sync.updatedAt', { date: acquired })}` : ''}` : acquired ? t('sync.updatedAt', { date: acquired }) : t('metrics.waiting')}{!card && endDay === dashboard.currentDay && <span> · {t('modules.partialToday')}</span>}</div>}
      </article>;
    })}
  </div>;
}
