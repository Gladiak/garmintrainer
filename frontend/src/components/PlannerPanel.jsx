import { useState } from 'react';
import { Check, Clock3, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { durationLabel, formatDay, shiftDay, weekDays } from '../lib/dates';
import { messageText } from '../lib/i18n';
import { useTranslation } from '../hooks/useTranslation';
import SessionForm, { SPORT_LABELS } from './SessionForm';
import Modal from './Modal';
import PeriodNavigation from './PeriodNavigation';

export default function PlannerPanel({ dashboard }) {
  const { t } = useTranslation();
  const { data, currentDay } = dashboard;
  const [weekAnchor, setWeekAnchor] = useState(null);
  const [formDate, setFormDate] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const days = weekDays(weekAnchor || currentDay);
  const sessions = data?.sessions || [];
  const weekly = sessions.filter(session => session.date >= days[0] && session.date <= days[6]);
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
      <PeriodNavigation from={days[0]} to={days[6]} onPrevious={() => setWeekAnchor(shiftDay(days[0], -7))} onNext={() => setWeekAnchor(shiftDay(days[0], 7))}
        onReset={() => setWeekAnchor(null)} isCurrent={days.includes(currentDay)} previousLabel={t('plan.previousWeek')} nextLabel={t('plan.nextWeek')} resetLabel={t('plan.thisWeek')} />
      <span className="week-total">{t('plan.sessions', { count: weekly.length })} · {durationLabel(weekly.reduce((sum, session) => sum + session.durationMinutes, 0))}</span>
      <button className="button secondary" onClick={() => setFormDate(currentDay >= days[0] && currentDay <= days[6] ? currentDay : days[0])}><Plus size={15} />{t('plan.newSession')}</button>
    </div>
    {error && <p className="form-error" role="alert">{messageText(error)}</p>}
    <div className="planner-week-board">{days.map(day => {
      const daySessions = weekly.filter(session => session.date === day).sort((a, b) => a.time.localeCompare(b.time));
      return <section key={day} className={`planner-day ${day === currentDay ? 'is-today' : ''}`} aria-label={formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' })}>
        <header><div><span>{formatDay(day, { weekday: 'short' })}</span><strong>{formatDay(day, { day: 'numeric', month: 'short' })}</strong></div><button className="icon-button" onClick={() => setFormDate(day)} aria-label={`${t('plan.add')} · ${formatDay(day, { day: 'numeric', month: 'short' })}`}><Plus size={15} /></button></header>
        <div className="planner-day-sessions">{daySessions.length ? daySessions.map(session => <article className={`planner-session ${session.status === 'completed' ? 'completed' : ''}`} key={session.id}><h3>{session.title}</h3><p>{t(SPORT_LABELS[session.sport])}</p><p><Clock3 size={12} />{durationLabel(session.durationMinutes)}{session.time && ` · ${session.time}`}</p>{session.notes && <div className="session-note">{session.notes}</div>}<div className="planner-session-actions"><button className={`completion-button ${session.status === 'completed' ? 'checked' : ''}`} disabled={busy === session.id} onClick={() => toggle(session)} aria-pressed={session.status === 'completed'} aria-label={t(session.status === 'completed' ? 'plan.markPlanned' : 'plan.complete', { title: session.title })}>{busy === session.id ? <LoaderCircle size={16} className="spin" /> : <Check size={15} />}</button><button className="icon-button" onClick={() => setDeleteTarget(session)} aria-label={t('plan.delete', { title: session.title })}><Trash2 size={15} /></button></div></article>) : <p className="planner-day-empty">{t('plan.noWorkouts')}</p>}</div>
      </section>;
    })}</div>
    {formDate && <SessionForm date={formDate} onClose={() => setFormDate(null)} onSave={async values => { const session = await dashboard.createSession(values); setWeekAnchor(session.date); setFormDate(null); }} />}
    {deleteTarget && <Modal title={t('session.deleteTitle')} subtitle={t('session.deleteSubtitle', { title: deleteTarget.title })} onClose={() => !busy && setDeleteTarget(null)}>{error && <p className="form-error">{messageText(error)}</p>}<div className="modal-actions"><button className="button secondary" disabled={Boolean(busy)} onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button><button className="button danger" disabled={Boolean(busy)} onClick={remove}>{t('session.delete')}</button></div></Modal>}
  </>;
}
