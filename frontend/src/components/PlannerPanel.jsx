import { useState } from 'react';
import { CalendarDays, Check, Clock3, CloudDownload, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { durationLabel, formatDay, shiftDay } from '../lib/dates';
import { activityLabel } from '../lib/activities';
import { plannerWeek } from '../lib/planner';
import { messageText } from '../lib/i18n';
import { useTranslation } from '../hooks/useTranslation';
import SessionForm, { SPORT_LABELS } from './SessionForm';
import Modal from './Modal';
import PeriodNavigation from './PeriodNavigation';

export default function PlannerPanel({ dashboard }) {
  const { t } = useTranslation();
  const { data, currentDay, planDays: days, setPlanAnchor } = dashboard;
  const [formDate, setFormDate] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const weekly = plannerWeek(data?.sessions || [], data?.activities.sessions || [], days);
  const hasGarmin = data?.profile.hasGarminKey;
  const garminPending = hasGarmin && (dashboard.loading || dashboard.syncing);
  const garminIncomplete = hasGarmin && !garminPending && (dashboard.garminConnection.error
    || data?.activities.complete === false && data.activities.dataState !== 'no_data');
  async function toggle(session) {
    setBusy(session.id); setError('');
    try { await dashboard.setSessionStatus(session.id, session.status === 'completed' ? 'planned' : 'completed'); }
    catch (failure) { setError(failure); }
    finally { setBusy(null); }
  }
  async function remove() {
    setBusy(deleteTarget.id); setError('');
    try { await dashboard.deleteSession(deleteTarget.id); setDeleteTarget(null); }
    catch (failure) { setError(failure); }
    finally { setBusy(null); }
  }
  return <>
    <div className="planner-toolbar">
      <PeriodNavigation from={days[0]} to={days[6]} onPrevious={() => setPlanAnchor(shiftDay(days[0], -7))} onNext={() => setPlanAnchor(shiftDay(days[0], 7))}
        onReset={() => setPlanAnchor(null)} isCurrent={days.includes(currentDay)} previousLabel={t('plan.previousWeek')} nextLabel={t('plan.nextWeek')} resetLabel={t('plan.thisWeek')} />
      <span className="week-total">{t('plan.sessions', { count: weekly.entries.length })} · {durationLabel(weekly.minutes)}<small>{t('plan.calendarTotal')}</small></span>
      <button className="button secondary" onClick={() => setFormDate(currentDay >= days[0] && currentDay <= days[6] ? currentDay : days[0])}><Plus size={15} />{t('plan.newSession')}</button>
    </div>
    <div className="planner-sources"><span><CalendarDays size={14} aria-hidden="true" />{t('plan.localSource')}</span><span className="planner-garmin-legend"><CloudDownload size={14} aria-hidden="true" />{t('plan.garminSource')} · {t('plan.readOnly')}</span></div>
    {garminPending && <p className="planner-sync-status" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" />{t('plan.garminLoading')}</p>}
    {garminIncomplete && <div className="planner-sync-status is-warning" role="status"><CloudDownload size={15} aria-hidden="true" /><span>{t('plan.garminIncomplete')}</span><button className="text-button" onClick={dashboard.reload}>{t('common.retry')}</button></div>}
    {hasGarmin && days[0] < shiftDay(currentDay, -365) && <p className="planner-sync-status">{t('plan.garminHistory')}</p>}
    {error && <p className="form-error" role="alert">{messageText(error)}</p>}
    <div className="planner-week-board">{weekly.days.map(({ date: day, sessions: daySessions, minutes }) => {
      return <section key={day} className={`planner-day ${day === currentDay ? 'is-today' : ''}`} aria-label={formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' })}>
        <header><div><span>{formatDay(day, { weekday: 'short' })}</span><strong>{formatDay(day, { day: 'numeric', month: 'short' })}</strong></div><button className="icon-button" onClick={() => setFormDate(day)} aria-label={`${t('plan.add')} · ${formatDay(day, { day: 'numeric', month: 'short' })}`}><Plus size={15} /></button></header>
        {daySessions.length > 0 && <p className="planner-day-total"><Clock3 size={12} aria-hidden="true" />{durationLabel(minutes)}</p>}
        <div className="planner-day-sessions">{daySessions.length ? daySessions.map(session => session.source === 'garmin'
          ? <article className="planner-session garmin-session" key={session.key}>
            <div className="planner-source-badge"><CloudDownload size={14} aria-hidden="true" /><span>Garmin Connect</span></div>
            <h3>{activityLabel(session, t)}</h3>
            <p><Clock3 size={12} aria-hidden="true" />{durationLabel(session.durationMinutes)}{session.time && ` · ${session.time}`}</p>
          </article>
          : <article className={`planner-session ${session.status === 'completed' ? 'completed' : ''}`} key={session.key}><h3>{session.title}</h3><p>{t(SPORT_LABELS[session.sport])}</p><p><Clock3 size={12} />{durationLabel(session.durationMinutes)}{session.time && ` · ${session.time}`}</p>{session.notes && <div className="session-note">{session.notes}</div>}<div className="planner-session-actions"><button className={`completion-button ${session.status === 'completed' ? 'checked' : ''}`} disabled={busy === session.id} onClick={() => toggle(session)} aria-pressed={session.status === 'completed'} aria-label={t(session.status === 'completed' ? 'plan.markPlanned' : 'plan.complete', { title: session.title })}>{busy === session.id ? <LoaderCircle size={16} className="spin" /> : <Check size={15} />}</button><button className="icon-button" onClick={() => setDeleteTarget(session)} aria-label={t('plan.delete', { title: session.title })}><Trash2 size={15} /></button></div></article>) : <p className="planner-day-empty">{t('plan.noWorkouts')}</p>}</div>
      </section>;
    })}</div>
    {formDate && <SessionForm date={formDate} onClose={() => setFormDate(null)} onSave={async values => { const session = await dashboard.createSession(values); setPlanAnchor(session.date); setFormDate(null); }} />}
    {deleteTarget && <Modal title={t('session.deleteTitle')} subtitle={t('session.deleteSubtitle', { title: deleteTarget.title })} onClose={() => !busy && setDeleteTarget(null)}>{error && <p className="form-error">{messageText(error)}</p>}<div className="modal-actions"><button className="button secondary" disabled={Boolean(busy)} onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button><button className="button danger" disabled={Boolean(busy)} onClick={remove}>{t('session.delete')}</button></div></Modal>}
  </>;
}
