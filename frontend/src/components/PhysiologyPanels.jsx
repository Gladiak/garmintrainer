import { formatNumber } from '../lib/numbers';
import { useTranslation } from '../hooks/useTranslation';
import { ChartEmpty, TrendChart } from './Charts';
import { durationLabel, formatDay } from '../lib/dates';
import { recoveryMetrics } from '../lib/recovery';
import { BatteryCharging, HeartPulse, Moon, Activity, TrendingUp } from 'lucide-react';
import { SPORT_LABELS } from './SessionForm';

export function HrvContext({ day }) {
  const { t, locale } = useTranslation();
  return <div className="physiology-context">
    <span>{t('health.hrvStatus')}: <strong>{day?.hrvStatus ? t(`health.hrv.${day.hrvStatus}`) : '—'}</strong></span>
    <span>{t('health.hrvBaseline')}: <strong>{Number.isFinite(day?.hrvBaselineLow) && Number.isFinite(day?.hrvBaselineHigh) && day.hrvBaselineLow <= day.hrvBaselineHigh ? `${formatNumber(day.hrvBaselineLow, locale)}–${formatNumber(day.hrvBaselineHigh, locale)} ms` : '—'}</strong></span>
    <span>{t('health.weeklyHrv')}: <strong>{formatNumber(day?.hrvWeeklyAvg, locale)} ms</strong></span>
  </div>;
}

export function PhysiologyChart({ daily, day, metric, period, from, to }) {
  const { t, locale } = useTranslation();
  if (period > 1) return <TrendChart daily={daily} metric={metric} days={period} from={from} to={to} />;
  const respiration = metric === 'respirationAvg';
  const fields = respiration ? [['respirationAvg', 'metrics.dailyAverage'], ['respirationMin', 'modules.minimum'], ['respirationMax', 'modules.maximum']] : [['spo2Avg', 'metrics.dailyAverage'], ['spo2Min', 'modules.minimum']];
  if (!fields.some(([field]) => Number.isFinite(day?.[field]))) return <ChartEmpty />;
  return <><dl className="physiology-values">{fields.map(([field, label]) => <div key={field}><dt>{t(label)}</dt><dd>{formatNumber(day?.[field], locale)} <small>{respiration ? t('health.breathsUnit') : '%'}</small></dd></div>)}</dl><p className="module-note">{t(respiration ? 'health.respirationHelp' : 'health.spo2Help')}</p></>;
}

function RecoveryMetric({ icon: Icon, label, value, unit, children }) {
  return <div className="recovery-metric"><dt><Icon size={15} aria-hidden="true" />{label}</dt><dd>{value}<small>{unit}</small></dd><div className="recovery-metric-context">{children}</div></div>;
}

export function TrainingStatus({ day, context, endDay }) {
  const { t, locale } = useTranslation();
  const metrics = recoveryMetrics(context, endDay);
  const { current, latestVo2, previousVo2 } = metrics;
  const number = value => formatNumber(value, locale);
  const signed = value => `${value > 0 ? '+' : ''}${number(value)}`;
  const date = value => formatDay(value, { day: 'numeric', month: 'short', year: 'numeric' });
  const baseline = Number.isFinite(day?.hrvBaselineLow) && Number.isFinite(day?.hrvBaselineHigh) && day.hrvBaselineLow <= day.hrvBaselineHigh;
  const sport = latestVo2?.activityType && Object.keys(SPORT_LABELS).find(key => latestVo2.activityType === key || latestVo2.activityType.includes(key));
  return <>
    <h3 className="recovery-section-title">{t('recovery.daily')}</h3>
    <dl className="recovery-grid">
      <RecoveryMetric icon={Moon} label={t('health.sleepScore')} value={number(day?.sleepScore)} unit="/100">
        <span>{t('metrics.sleep')}: {Number.isFinite(day?.sleepMinutes) ? durationLabel(day.sleepMinutes) : '—'}</span>
        <span>{t('recovery.sleepAverage', { value: number(metrics.sleep.value), count: metrics.sleep.count })}</span>
      </RecoveryMetric>
      <RecoveryMetric icon={HeartPulse} label={t('recovery.nightlyHrv')} value={number(day?.hrv)} unit="ms">
        <span>{t('health.hrvStatus')}: {day?.hrvStatus ? t(`health.hrv.${day.hrvStatus}`) : '—'}</span>
        <span>{t('health.weeklyHrv')}: {number(day?.hrvWeeklyAvg)} ms</span>
        <span>{t('health.hrvBaseline')}: {baseline ? `${number(day.hrvBaselineLow)}–${number(day.hrvBaselineHigh)} ms` : '—'}</span>
      </RecoveryMetric>
      <RecoveryMetric icon={BatteryCharging} label={t('metrics.bodyBattery')} value={number(day?.bodyBattery)} unit="/100">
        <span>{t('recovery.latestBattery')}</span>
        <span>{t('metrics.stress')}: {number(day?.stress)}/100 · {t('metrics.dailyAverage')}</span>
      </RecoveryMetric>
      <RecoveryMetric icon={HeartPulse} label={t('metrics.heartReference')} value={number(day?.heartRateReferenceBpm)} unit="bpm">
        <span>{t('recovery.heartAverage', { value: number(metrics.heart.value), count: metrics.heart.count })}</span>
        {Number.isFinite(day?.heartRateReferenceBpm) && Number.isFinite(metrics.heart.value) && <span>{t('recovery.heartChange', { value: signed(day.heartRateReferenceBpm - metrics.heart.value) })}</span>}
        <span>{t('metrics.heartHelp')}</span>
      </RecoveryMetric>
    </dl>
    <h3 className="recovery-section-title">{t('recovery.fitness')}</h3>
    <dl className="recovery-grid">
      <RecoveryMetric icon={TrendingUp} label="VO₂ max" value={number(latestVo2?.vo2Max)} unit="ml/kg/min">
        <span>{latestVo2 ? `${date(latestVo2.date)} · ${sport ? t(SPORT_LABELS[sport]) : latestVo2.activityType?.replaceAll('_', ' ') || t('activity.genericActivity')}` : t('recovery.noVo2')}</span>
        <span>{previousVo2 ? t('recovery.vo2Change', { value: signed(latestVo2.vo2Max - previousVo2.vo2Max), date: date(previousVo2.date) }) : t('recovery.vo2Single')}</span>
      </RecoveryMetric>
      <RecoveryMetric icon={Activity} label={t('recovery.weeklyLoad')} value={number(current.load)} unit={t('recovery.loadUnit')}>
        <span>{date(current.from)} – {date(current.to)}</span>
        <span>{t('recovery.weekVolume', { duration: Number.isFinite(current.minutes) ? durationLabel(current.minutes) : '—', count: current.count })}</span>
        <span>{t('training.coverage', { count: current.loadCount, total: current.count })}{!current.complete || !current.loadComplete ? ` · ${t('recovery.partial')}` : ''}</span>
        {Number.isFinite(metrics.loadChange) && <span>{t('recovery.loadChange', { value: signed(metrics.loadChange) })}</span>}
      </RecoveryMetric>
    </dl>
    <p className="module-note recovery-explanation">{t('recovery.help')}</p>
  </>;
}

