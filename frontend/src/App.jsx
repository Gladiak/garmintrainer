import { messageText, setProfileLanguage } from './lib/i18n';
import { useTranslation } from './hooks/useTranslation';
import { useEffect, useLayoutEffect, useMemo, useReducer, useState } from 'react';
import {
  Activity, ArrowRight, ArrowUpRight, BatteryCharging, Bike, CalendarDays,
  Check, ChevronLeft, ChevronRight, CircleCheck, Clock3, Dumbbell, Footprints,
  HeartPulse, Info, LayoutDashboard, Link2, LoaderCircle, Menu, Moon,
  Plus, RefreshCw, ShieldCheck, Trash2, Waves, X, Zap,
} from 'lucide-react';
import { useDashboard } from './hooks/useDashboard';
import { demoData, METRICS } from './lib/demo';
import { createDemoPlan, demoPlanReducer, translateDemoSessions } from './lib/demo-plan';
import { today, shiftDay, weekDays, formatDay, durationLabel } from './lib/dates';
import TrainingLoad from './components/TrainingLoad';
import { TrendChart, SleepChart } from './components/Charts';
import SessionForm, { SPORT_LABELS } from './components/SessionForm';
import Modal from './components/Modal';
import ProfileModal, { profileName, PRIMARY_SPORT_LABELS } from './components/ProfileModal';
import SettingsModal from './components/SettingsModal';
import SidebarAccountMenu from './components/SidebarAccountMenu';
import { useTheme } from './components/ThemeProvider';

const SPORT_ICONS = { running: Footprints, cycling: Bike, strength: Dumbbell, walking: Footprints, mobility: Activity, swimming: Waves };

function Sparkline({ values, color }) {
  const valid = values.filter((value) => value !== null);
  if (!valid.length) return <span className="sparkline-placeholder" />;
  const min = Math.min(...valid) - 2;
  const max = Math.max(...valid) + 2;
  const points = valid.map((value, index) => `${index * (88 / Math.max(1, valid.length - 1))},${30 - ((value - min) / (max - min)) * 28}`).join(' ');
  return <svg className="sparkline" viewBox="0 0 90 34" aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function MetricCard({ icon: Icon, label, value, unit, caption, values, tone, color, demo }) {
  const { t } = useTranslation();
  return <article className={`metric-card tone-${tone}`}>
    <div className="metric-top"><span className="metric-icon"><Icon size={18} strokeWidth={1.7} /></span><span className="metric-label">{label}</span>{demo && <span className="example-dot" title={t('common.example')} aria-label={t('common.example')} />}</div>
    <div className="metric-body"><div className="metric-value">{value}<span>{unit}</span></div><Sparkline values={values} color={color} /></div>
    <p className="metric-caption">{caption}</p>
  </article>;
}

export default function App({ user, onLogout }) {
  const { t, language } = useTranslation();
  const { metricColors, sleepColors: SLEEP_COLORS, setProfileTheme } = useTheme();
  const dashboard = useDashboard();
  const { data, loading, error, garminConnection } = dashboard;
  const currentDay = today();
  const [demo, setDemo] = useState(false);
  const [demoPlan, dispatchDemoPlan] = useReducer(demoPlanReducer, currentDay, createDemoPlan);
  const [period, setPeriod] = useState(14);
  const [metric, setMetric] = useState('restingHeartRate');
  const [selectedDay, setSelectedDay] = useState(currentDay);
  const [sessionForm, setSessionForm] = useState(false);
  const [profileDialog, setProfileDialog] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [busySession, setBusySession] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeNav, setActiveNav] = useState('overview');
  const [notice, setNotice] = useState('');
  const samples = useMemo(() => demo ? demoData(currentDay) : (data?.measurements.daily || []), [demo, currentDay, data]);
  const latest = samples.at(-1);
  const days = weekDays(selectedDay);
  const sessions = useMemo(() => demo ? translateDemoSessions(demoPlan.sessions, t) : data?.sessions || [], [demo, demoPlan.sessions, data?.sessions, language, t]);
  const canEditPlan = demo || Boolean(data?.profile && !loading && !error);
  const weeklySessions = sessions.filter((session) => session.date >= days[0] && session.date <= days[6]);
  const selectedSessions = sessions.filter((session) => session.date === selectedDay).sort((a, b) => a.time.localeCompare(b.time));
  const plannedMinutes = weeklySessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const garmin = data?.garmin;
  const garminLabel = error ? t('connection.backendUnavailable') : garminConnection.connecting ? t('connection.connectingGarmin') : garminConnection.error ? t('connection.checkGarmin') : garmin?.valid ? t('connection.garminReady') : garmin?.configured ? t('connection.garminConfigured') : t('connection.linkGarmin');
  const profile = data?.profile;
  useLayoutEffect(() => {
    if (profile) setProfileTheme(profile.theme, profile.id);
    else if (!loading) setProfileTheme();
  }, [profile?.id, profile?.theme, loading, setProfileTheme]);
  useLayoutEffect(() => {
    if (profile) setProfileLanguage(profile.language, profile.id);
    else if (!loading) setProfileLanguage();
  }, [profile?.id, profile?.language, loading]);
  const metricConfig = METRICS[metric];
  const sleepMinutes = latest ? latest.deep + latest.light + latest.rem : null;

  useEffect(() => {
    setSessionForm(false); setDeleteTarget(null); setDemo(false); setNotice('');
  }, [dashboard.profileId]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);

  function navigate(name) { setActiveNav(name); setMenuOpen(false); }
  function togglePreview() {
    dispatchDemoPlan({ type: 'reset', endDay: currentDay });
    setSessionForm(false); setDeleteTarget(null); setNotice(''); setSelectedDay(currentDay);
    setDemo(!demo);
  }
  async function saveSession(values) {
    if (demo) {
      dispatchDemoPlan({ type: 'create', values });
      setSelectedDay(values.date); setSessionForm(false); setNotice({ key: 'demo.sessionSaved' });
      return;
    }
    const session = await dashboard.createSession(values);
    setSelectedDay(session.date); setSessionForm(false); setNotice({ key: 'notices.sessionSaved' });
  }
  async function toggleCompleted(session) {
    if (demo) {
      dispatchDemoPlan({ type: 'status', id: session.id, status: session.status === 'completed' ? 'planned' : 'completed' });
      return;
    }
    setBusySession(session.id);
    try { await dashboard.setSessionStatus(session.id, session.status === 'completed' ? 'planned' : 'completed'); }
    catch (failure) { setNotice(failure); }
    finally { setBusySession(null); }
  }
  async function removeSession() {
    if (demo) {
      dispatchDemoPlan({ type: 'delete', id: deleteTarget.id });
      setDeleteTarget(null); setNotice({ key: 'demo.sessionDeleted' });
      return;
    }
    setDeleting(true);
    try { await dashboard.deleteSession(deleteTarget.id); setDeleteTarget(null); setNotice({ key: 'notices.sessionDeleted' }); }
    catch (failure) { setNotice(failure); }
    finally { setDeleting(false); }
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">{t('nav.skip')}</a>
    {menuOpen && <button className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-label={t('nav.close')} />}
    <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`} aria-label={t('nav.main')}>
      <a className="brand" href="#overview" onClick={() => navigate('overview')}><span className="brand-mark"><Activity size={24} strokeWidth={2.3} /></span><span>garmin<span className="brand-light">trainer</span><small>{t('nav.personalSpace')}</small></span></a>
      <div className="sidebar-label">{t('nav.journey')}</div>
      <nav>
        <a className={activeNav === 'overview' ? 'nav-link active' : 'nav-link'} href="#overview" onClick={() => navigate('overview')}><LayoutDashboard size={18} />{t('nav.overview')}<span className="nav-indicator" /></a>
        <a className={activeNav === 'wellness' ? 'nav-link active' : 'nav-link'} href="#wellness" onClick={() => navigate('wellness')}><HeartPulse size={18} />{t('nav.wellness')}<span className="nav-indicator" /></a>
        <a className={activeNav === 'plan' ? 'nav-link active' : 'nav-link'} href="#plan" onClick={() => navigate('plan')}><CalendarDays size={18} />{t('nav.plan')}<span className="nav-indicator" /></a>
      </nav>
      <div className="sidebar-divider" />
      <div className="sidebar-note"><span className="leaf-mark"><Activity size={23} /></span><h3>{t('nav.rhythm')}</h3><p>{t('nav.nextStep')}</p><a href="#plan" onClick={() => navigate('plan')}>{t('nav.organize')} <ArrowUpRight size={15} /></a><div className="note-orbit orbit-one" /><div className="note-orbit orbit-two" /></div>
      <SidebarAccountMenu profile={profile} name={profile?.firstName ? profileName(profile) : user.username} subtitle={t(PRIMARY_SPORT_LABELS[profile?.primarySport] || 'nav.localStorage')} sidebarOpen={menuOpen}
        onProfile={() => { setProfileDialog('form'); setMenuOpen(false); }}
        onSettings={() => { setSettingsOpen(true); setMenuOpen(false); }}
        onLogout={async () => { try { await onLogout(); } catch (failure) { setNotice(failure); } }} />
    </aside>

    <div className="workspace">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label={t('nav.open')} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Menu size={21} /></button><span>{profile?.firstName || t('nav.yourSpace')}</span><ChevronRight size={13} /><strong>{t('nav.overview')}</strong></div><div className="topbar-right"><span className="top-date"><CalendarDays size={15} />{formatDay(currentDay, { day: 'numeric', month: 'long', year: 'numeric' })}</span></div></header>

      <main id="main-content">
        <section className="page-heading" id="overview"><div><div className="eyebrow"><span />{t('page.eyebrow')}</div><h1>{t('page.heading')}<span>.</span></h1><p>{t('page.subtitle')}</p></div><div className="heading-actions"><button className={`status-pill ${garmin?.configured && !error && !garminConnection.error ? 'configured' : ''}`} onClick={() => setProfileDialog('form')}><i />{loading && !data ? t('page.connecting') : garminLabel}<ChevronRight size={13} /></button><button className="button secondary refresh-button" onClick={dashboard.reload} disabled={loading} aria-label={t('page.refreshLabel')}><RefreshCw size={16} className={loading ? 'spin' : ''} /><span>{t('page.refresh')}</span></button></div></section>

        {error && <div className="error-banner" role="alert"><Info size={18} /><span>{messageText(error)} {!demo && t('page.backendHint')}</span><button onClick={dashboard.reload}>{t('common.retry')}</button></div>}
        {!error && garminConnection.error && <div className="error-banner" role="alert"><Link2 size={18} /><span>{messageText(garminConnection.error)} {t('page.localPlanAvailable')}</span><button onClick={dashboard.reload}>{t('common.retry')}</button></div>}
        {!loading && !error && (!profile || profile.needsCompletion) && <div className="profile-banner"><ShieldCheck size={18} /><p>{profile ? t('page.completeProfile') : t('page.createProfile')}</p><button className="button secondary" onClick={() => setProfileDialog('form')}>{profile ? t('page.completeAction') : t('page.createAction')}</button></div>}

        <div className={`data-notice ${demo ? 'demo-active' : ''}`}><span className="notice-symbol"><Info size={16} /></span><p>{demo ? <><strong>{t('demo.title')}</strong> {t('demo.description')}</> : <><strong>{t('demo.ready')}</strong> {t('demo.waiting')}</>}</p><button className="demo-toggle" aria-pressed={demo} disabled={Boolean(busySession) || deleting} onClick={togglePreview}><span className="toggle-track"><span /></span>{demo ? t('demo.close') : t('demo.explore')}</button></div>

        <section className="metrics-grid" aria-label={demo ? t('metrics.demoLabel') : t('metrics.waitingLabel')}>
          <MetricCard icon={HeartPulse} label={t('metrics.restingHeartRate')} value={latest?.restingHeartRate ?? '—'} unit={latest ? 'bpm' : ''} caption={demo ? t('metrics.heartCaption') : t('metrics.waiting')} values={samples.slice(-12).map((day) => day.restingHeartRate)} tone="sage" color={metricColors.restingHeartRate} demo={demo} />
          <MetricCard icon={Moon} label={t('metrics.sleep')} value={sleepMinutes !== null ? t('common.hours', { count: Math.floor(sleepMinutes / 60) }) : '—'} unit={sleepMinutes !== null ? t('common.minutes', { count: sleepMinutes % 60 }) : ''} caption={demo ? t('metrics.sleepCaption') : t('metrics.waiting')} values={samples.slice(-12).map((day) => day.deep + day.light + day.rem)} tone="moss" color={metricColors.hrv} demo={demo} />
          <MetricCard icon={BatteryCharging} label={t('metrics.bodyBattery')} value={latest?.bodyBattery ?? '—'} unit={latest ? '/ 100' : ''} caption={demo ? t('metrics.batteryCaption') : t('metrics.waiting')} values={samples.slice(-12).map((day) => day.bodyBattery)} tone="mist" color={metricColors.bodyBattery} demo={demo} />
          <MetricCard icon={Zap} label={t('metrics.stress')} value={latest?.stress ?? '—'} unit={latest ? '/ 100' : ''} caption={demo ? t('metrics.stressCaption') : t('metrics.waiting')} values={samples.slice(-12).map((day) => day.stress)} tone="sand" color={metricColors.bodyBattery} demo={demo} />
        </section>

        <section className="wellness-grid" id="wellness" aria-label={t('wellness.label')}>
          <article className="panel trend-panel">
            <div className="panel-heading"><div><h2>{t('trend.title')}</h2><p>{t('trend.subtitle')}</p></div><select className="period-select" aria-label={t('trend.period')} value={period} onChange={(event) => setPeriod(Number(event.target.value))}>{[7, 14, 30].map((count) => <option key={count} value={count}>{t('trend.lastDays', { count })}</option>)}</select></div>
            <div className="trend-toolbar"><div className="metric-tabs" role="group" aria-label={t('trend.metric')}>{Object.entries(METRICS).map(([key, config]) => <button key={key} aria-pressed={metric === key} className={metric === key ? 'selected' : ''} onClick={() => setMetric(key)}>{t(config.label)}</button>)}</div><div className="trend-current"><strong>{latest?.[metric] ?? '—'}</strong><span>{latest ? metricConfig.unit : ''}</span></div></div>
            <TrendChart daily={samples} metric={metric} days={period} />
            <div className="chart-footnote"><span><i style={{ background: metricColors[metric] }} />{t(metricConfig.label)}</span><span>{demo ? t('trend.demoFootnote') : t('trend.noData')}</span></div>
          </article>
          <article className="panel sleep-panel">
            <div className="panel-heading"><div><h2>{t('sleep.title')}</h2><p>{t('sleep.subtitle')}</p></div><span className="soft-icon moss"><Moon size={19} /></span></div>
            <div className="sleep-summary"><strong>{sleepMinutes !== null ? durationLabel(sleepMinutes) : '—'}</strong><span>{demo ? t('sleep.lastNight') : t('sleep.waiting')}</span></div>
            <SleepChart daily={samples} />
            <div className="sleep-legend"><span><i style={{ background: SLEEP_COLORS.Profondo }} />{t('sleep.deep')}</span><span><i style={{ background: SLEEP_COLORS.Leggero }} />{t('sleep.light')}</span><span><i style={{ background: SLEEP_COLORS.REM }} />{t('sleep.rem')}</span></div>
          </article>
        </section>

        <section className="planning-grid" id="plan" aria-label={t(demo ? 'demo.planLabel' : 'plan.label')}>
          <article className="panel plan-panel"><div className="panel-heading"><div><h2>{t('plan.title')}<span className="tiny-label">{t(demo ? 'demo.badge' : 'plan.personal')}</span></h2><p>{t('plan.subtitle')}</p></div><button className="button secondary add-session" onClick={() => setSessionForm(true)} disabled={!canEditPlan}><Plus size={16} /><span>{t('plan.newSession')}</span></button></div>
            <div className="week-toolbar"><strong>{formatDay(days[0], { day: 'numeric' })} – {formatDay(days[6], { day: 'numeric', month: 'long' })}</strong><span className="week-total">{t('plan.sessions', { count: weeklySessions.length })} <i />{durationLabel(plannedMinutes)}</span><div className="week-buttons"><button className="icon-button" aria-label={t('plan.previousWeek')} onClick={() => setSelectedDay(shiftDay(selectedDay, -7))}><ChevronLeft size={17} /></button><button className="today-button" onClick={() => setSelectedDay(currentDay)}>{t('plan.today')}</button><button className="icon-button" aria-label={t('plan.nextWeek')} onClick={() => setSelectedDay(shiftDay(selectedDay, 7))}><ChevronRight size={17} /></button></div></div>
            <div className="week-days">{days.map((day) => <button key={day} onClick={() => setSelectedDay(day)} aria-pressed={day === selectedDay} aria-label={formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' })} className={`${day === selectedDay ? 'selected' : ''} ${day === currentDay ? 'is-today' : ''}`}><span>{formatDay(day, { weekday: 'short' })}</span><strong>{formatDay(day, { day: 'numeric' })}</strong><i className={sessions.some((session) => session.date === day) ? 'has-session' : ''} /></button>)}</div>
            <div className="session-list">{selectedSessions.length ? selectedSessions.map((session) => {
              const Icon = SPORT_ICONS[session.sport] || Activity;
              return <div className={`session-item ${session.status === 'completed' ? 'completed' : ''}`} key={session.id}><span className={`session-sport sport-${session.sport}`}><Icon size={21} /></span><div className="session-copy"><h3>{session.title}</h3><p>{t(SPORT_LABELS[session.sport])}<span>·</span><Clock3 size={12} />{durationLabel(session.durationMinutes)}{session.time && <><span>·</span>{session.time}</>}</p>{session.notes && <div className="session-note">{session.notes}</div>}</div><button className={`completion-button ${session.status === 'completed' ? 'checked' : ''}`} disabled={busySession === session.id} onClick={() => toggleCompleted(session)} aria-label={t(session.status === 'completed' ? 'plan.markPlanned' : 'plan.complete', { title: session.title })} aria-pressed={session.status === 'completed'}>{busySession === session.id ? <LoaderCircle size={16} className="spin" /> : <Check size={15} />}</button><button className="icon-button delete-button" onClick={() => setDeleteTarget(session)} aria-label={t('plan.delete', { title: session.title })}><Trash2 size={15} /></button></div>;
            }) : <div className="plan-empty"><span><CalendarDays size={24} /></span><div><strong>{t('plan.emptyTitle')}</strong><p>{t('plan.emptyDescription', { date: formatDay(selectedDay, { day: 'numeric', month: 'long' }) })}</p></div><button className="text-button" disabled={!canEditPlan} onClick={() => setSessionForm(true)}>{t('plan.add')} <ArrowRight size={14} /></button></div>}</div>
            <div className="plan-footer">{demo ? <Info size={14} /> : <ShieldCheck size={14} />}{t(demo ? 'demo.planFooter' : 'plan.footer')}</div>
          </article>

        <TrainingLoad key={`${dashboard.profileId || 'no-profile'}:${demo ? 'preview' : 'real'}`} sessions={sessions} endDay={currentDay} loading={!demo && loading} unavailable={!demo && Boolean(error)} preview={demo} />
        </section>
        <footer className="page-footer"><span>garmin<span>trainer</span></span><p>{t('footer.tagline')}</p><span className="local-footer"><CircleCheck size={13} />{error ? t('storage.unavailable') : data?.storage.ready ? t('storage.ready') : t('storage.connecting')}</span></footer>
      </main>
    </div>
    {notice && <div className="toast" role="status"><CircleCheck size={17} /><span>{messageText(notice)}</span><button className="icon-button" onClick={() => setNotice('')} aria-label={t('notices.close')}><X size={16} /></button></div>}
    {sessionForm && <SessionForm preview={demo} date={selectedDay} onClose={() => setSessionForm(false)} onSave={saveSession} />}
    {profile && (profileDialog || profile.needsCompletion) && <ProfileModal key={profile.id} profile={profile} required={profile.needsCompletion} onClose={() => setProfileDialog(null)} onSave={async (id, values) => { await dashboard.saveProfile(id, values); setProfileDialog(null); setNotice({ key: 'notices.profileSaved' }); }} />}
    {settingsOpen && <SettingsModal profile={profile} onClose={() => setSettingsOpen(false)} onProfiles={() => { setSettingsOpen(false); setProfileDialog('form'); }} onSave={async (id, theme) => { await dashboard.saveTheme(id, theme); setNotice({ key: 'notices.settingsSaved' }); }} />}
    {deleteTarget && <Modal title={t('session.deleteTitle')} subtitle={t(demo ? 'demo.deleteSubtitle' : 'session.deleteSubtitle', { title: deleteTarget.title })} onClose={deleting ? () => {} : () => setDeleteTarget(null)}><div className="modal-actions"><button className="button secondary" disabled={deleting} onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button><button className="button danger" disabled={deleting} onClick={removeSession}>{deleting ? t('common.deleting') : t('session.delete')}</button></div></Modal>}
  </div>;
}
