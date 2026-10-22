import { messageText, setProfileLanguage } from './lib/i18n';
import { useTranslation } from './hooks/useTranslation';
import { useEffect, useLayoutEffect, useState } from 'react';
import {
  Activity, ArrowRight, ArrowUpRight, BatteryCharging, Bike, CalendarDays,
  Check, ChevronLeft, ChevronRight, CircleCheck, Clock3, Dumbbell, Footprints,
  HeartPulse, Info, LayoutDashboard, Link2, LoaderCircle, Menu, Moon,
  Plus, RefreshCw, ShieldCheck, Trash2, Waves, X, Zap,
} from 'lucide-react';
import { useDashboard } from './hooks/useDashboard';
import { latestMeasurement, METRICS } from './lib/measurements';
import { shiftDay, weekDays, formatDay, durationLabel } from './lib/dates';
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
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return <span className="sparkline-placeholder" />;
  const min = Math.min(...valid) - 2;
  const max = Math.max(...valid) + 2;
  let previous = false;
  const path = values.map((value, index) => {
    if (!Number.isFinite(value)) { previous = false; return ''; }
    const command = previous ? 'L' : 'M'; previous = true;
    return `${command}${index * (88 / Math.max(1, values.length - 1))},${30 - ((value - min) / (max - min)) * 28}`;
  }).join(' ');
  return <svg className="sparkline" viewBox="0 0 90 34" aria-hidden="true"><path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function MetricCard({ icon: Icon, label, value, unit, caption, values, tone, color }) {
  return <article className={`metric-card tone-${tone}`}>
    <div className="metric-top"><span className="metric-icon"><Icon size={18} strokeWidth={1.7} /></span><span className="metric-label">{label}</span></div>
    <div className="metric-body"><div className="metric-value">{value}<span>{unit}</span></div><Sparkline values={values} color={color} /></div>
    <p className="metric-caption">{caption}</p>
  </article>;
}

export default function App({ user, onLogout }) {
  const { t, locale } = useTranslation();
  const { metricColors, sleepColors: SLEEP_COLORS, setProfileTheme } = useTheme();
  const dashboard = useDashboard();
  const { data, loading, syncing, error, garminConnection, period, setPeriod, endDay, visibleFrom, currentDay } = dashboard;
  const [metric, setMetric] = useState('heartRateReferenceBpm');
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
  const samples = (data?.measurements.daily || []).filter(day => day.date >= shiftDay(endDay, -(Math.max(period, 12) - 1)) && day.date <= endDay);
  const trendSamples = samples.filter(day => day.date >= visibleFrom && day.date <= endDay);
  const heart = latestMeasurement(samples, 'heartRateReferenceBpm');
  const sleep = latestMeasurement(samples, 'sleepMinutes');
  const battery = latestMeasurement(samples, 'bodyBattery');
  const stress = latestMeasurement(samples, 'stress');
  const trendLatest = latestMeasurement(trendSamples, metric);
  const days = weekDays(selectedDay);
  const sessions = data?.sessions || [];
  const canEditPlan = Boolean(data?.profile && !loading && !error);
  const weeklySessions = sessions.filter((session) => session.date >= days[0] && session.date <= days[6]);
  const selectedSessions = sessions.filter((session) => session.date === selectedDay).sort((a, b) => a.time.localeCompare(b.time));
  const plannedMinutes = weeklySessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const garmin = data?.garmin;
  const garminStatusKey = error ? 'connection.backendUnavailable' : loading && !data ? 'page.connecting' : garminConnection.connecting ? 'connection.connectingGarmin' : garminConnection.error ? 'connection.checkGarmin' : garmin?.valid ? 'connection.garminReady' : garmin?.configured ? 'connection.garminConfigured' : 'connection.linkGarmin';
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
  const sleepMinutes = sleep ? Math.round(sleep.sleepMinutes) : null;
  const syncTimes = Object.values(data?.measurements.sync || {}).map(state => state.lastSuccessAt).filter(Boolean);
  const lastSync = syncTimes.length ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short', timeZone: data.timeZone }).format(new Date(Math.min(...syncTimes.map(Date.parse)))) : null;
  const hasMeasurements = samples.some(day => ['heartRateReferenceBpm', 'hrv', 'bodyBattery', 'stress', 'sleepMinutes'].some(key => Number.isFinite(day[key])));
  const metricDate = day => day ? formatDay(day.date, { day: 'numeric', month: 'short' }) : t('metrics.waiting');

  useEffect(() => {
    setSessionForm(false); setDeleteTarget(null); setNotice('');
  }, [dashboard.profileId]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);

  function navigate(name) { setActiveNav(name); setMenuOpen(false); }
  async function saveSession(values) {
    const session = await dashboard.createSession(values);
    setSelectedDay(session.date); setSessionForm(false); setNotice({ key: 'notices.sessionSaved' });
  }
  async function toggleCompleted(session) {
    setBusySession(session.id);
    try { await dashboard.setSessionStatus(session.id, session.status === 'completed' ? 'planned' : 'completed'); }
    catch (failure) { setNotice(failure); }
    finally { setBusySession(null); }
  }
  async function removeSession() {
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
      <div className="sidebar-bottom">
        <div className="sidebar-note"><span className="leaf-mark"><Activity size={23} /></span><h3>{t('nav.rhythm')}</h3><p>{t('nav.nextStep')}</p><a href="#plan" onClick={() => navigate('plan')}>{t('nav.organize')} <ArrowUpRight size={15} /></a><div className="note-orbit orbit-one" /><div className="note-orbit orbit-two" /></div>
        <SidebarAccountMenu profile={profile} name={profile?.firstName ? profileName(profile) : user.username} subtitle={t(PRIMARY_SPORT_LABELS[profile?.primarySport] || 'nav.localStorage')} sidebarOpen={menuOpen}
          onProfile={() => { setProfileDialog('form'); setMenuOpen(false); }}
          onSettings={() => { setSettingsOpen(true); setMenuOpen(false); }}
          onLogout={async () => { try { await onLogout(); } catch (failure) { setNotice(failure); } }} />
      </div>
    </aside>

    <div className="workspace">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label={t('nav.open')} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Menu size={21} /></button><span>{profile?.firstName || t('nav.yourSpace')}</span><ChevronRight size={13} /><strong>{t('nav.overview')}</strong></div><div className="topbar-right"><span className="top-date"><CalendarDays size={15} />{formatDay(currentDay, { day: 'numeric', month: 'long', year: 'numeric' })}</span></div></header>

      <main id="main-content">
        <section className="page-heading" id="overview"><div><div className="eyebrow"><span />{t('page.eyebrow')}</div><h1>{t('page.heading')}<span>.</span></h1><p>{t('page.subtitle')}</p></div><div className="heading-actions"><button className="button secondary refresh-button" onClick={dashboard.reload} disabled={loading || syncing} aria-label={t('page.refreshLabel')}><RefreshCw size={16} className={loading || syncing ? 'spin' : ''} /><span>{t('page.refresh')}</span></button></div></section>

        {error && <div className="error-banner" role="alert"><Info size={18} /><span>{messageText(error)} {t('page.backendHint')}</span><button onClick={dashboard.reload}>{t('common.retry')}</button></div>}
        {!error && garminConnection.error && <div className="error-banner" role="alert"><Link2 size={18} /><span>{messageText(garminConnection.error)} {t('page.localPlanAvailable')}</span><button onClick={dashboard.reload}>{t('common.retry')}</button></div>}
        {!loading && !error && (!profile || profile.needsCompletion) && <div className="profile-banner"><ShieldCheck size={18} /><p>{profile ? t('page.completeProfile') : t('page.createProfile')}</p><button className="button secondary" onClick={() => setProfileDialog('form')}>{profile ? t('page.completeAction') : t('page.createAction')}</button></div>}

        <div className="data-notice" role="status"><span className="notice-symbol"><Info size={16} /></span><p><strong>{t(syncing ? 'sync.working' : profile?.hasGarminKey ? hasMeasurements ? 'sync.realData' : 'sync.noData' : 'sync.connect')}</strong> {t('sync.description')}{lastSync && <> {t('sync.updatedAt', { date: lastSync })}</>}</p></div>

        <section className="metrics-grid" aria-label={t('metrics.realLabel')}>
          <MetricCard icon={HeartPulse} label={t('metrics.heartReference')} value={heart?.heartRateReferenceBpm ?? '—'} unit={heart ? 'bpm' : ''} caption={`${metricDate(heart)} · ${t('metrics.heartHelp')}`} values={samples.slice(-12).map(day => day.heartRateReferenceBpm)} tone="sage" color={metricColors.restingHeartRate} />
          <MetricCard icon={Moon} label={t('metrics.sleep')} value={sleepMinutes !== null ? t('common.hours', { count: Math.floor(sleepMinutes / 60) }) : '—'} unit={sleepMinutes !== null ? t('common.minutes', { count: Math.round(sleepMinutes % 60) }) : ''} caption={metricDate(sleep)} values={samples.slice(-12).map(day => day.sleepMinutes)} tone="moss" color={metricColors.hrv} />
          <MetricCard icon={BatteryCharging} label={t('metrics.bodyBattery')} value={battery?.bodyBattery ?? '—'} unit={battery ? '/ 100' : ''} caption={metricDate(battery)} values={samples.slice(-12).map(day => day.bodyBattery)} tone="mist" color={metricColors.bodyBattery} />
          <MetricCard icon={Zap} label={t('metrics.stress')} value={stress?.stress ?? '—'} unit={stress ? '/ 100' : ''} caption={`${metricDate(stress)} · ${t('metrics.dailyAverage')}`} values={samples.slice(-12).map(day => day.stress)} tone="sand" color={metricColors.bodyBattery} />
        </section>

        <section className="wellness-grid" id="wellness" aria-label={t('wellness.label')}>
          <article className="panel trend-panel">
            <div className="panel-heading"><div><h2>{t('trend.title')}</h2><p>{t('trend.subtitle')}</p></div><select className="period-select" aria-label={t('trend.period')} value={period} onChange={(event) => setPeriod(Number(event.target.value))}>{[7, 14, 30].map((count) => <option key={count} value={count}>{t('trend.lastDays', { count })}</option>)}</select></div>
            <div className="measurement-navigation"><span>{formatDay(visibleFrom, { day: 'numeric', month: 'short' })} – {formatDay(endDay, { day: 'numeric', month: 'short', year: 'numeric' })}</span><div><button className="icon-button" aria-label={t('sync.previousPeriod')} disabled={shiftDay(endDay, -(period + Math.max(period, 12) - 1)) < shiftDay(currentDay, -89)} onClick={() => dashboard.shiftPeriod(-1)}><ChevronLeft size={16} /></button><button className="today-button" onClick={dashboard.resetPeriod}>{t('plan.today')}</button><button className="icon-button" aria-label={t('sync.nextPeriod')} disabled={shiftDay(endDay, period) > currentDay} onClick={() => dashboard.shiftPeriod(1)}><ChevronRight size={16} /></button></div></div>
            <div className="trend-toolbar"><div className="metric-tabs" role="group" aria-label={t('trend.metric')}>{Object.entries(METRICS).map(([key, config]) => <button key={key} aria-pressed={metric === key} className={metric === key ? 'selected' : ''} onClick={() => setMetric(key)}>{t(config.label)}</button>)}</div><div className="trend-current"><strong>{trendLatest?.[metric] ?? '—'}</strong><span>{trendLatest ? metricConfig.unit : ''}</span></div></div>
            <TrendChart daily={trendSamples} metric={metric} days={period} from={visibleFrom} to={endDay} />
            <div className="chart-footnote"><span><i style={{ background: metricColors[metricConfig.color] }} />{t(metricConfig.label)}</span><span>{t('sync.source')}</span></div>
          </article>
          <article className="panel sleep-panel">
            <div className="panel-heading"><div><h2>{t('sleep.title')}</h2><p>{t('sleep.subtitle')}</p></div><span className="soft-icon moss"><Moon size={19} /></span></div>
            <div className="sleep-summary"><strong>{sleepMinutes !== null ? durationLabel(sleepMinutes) : '—'}</strong><span>{metricDate(sleep)}</span></div>
            <SleepChart daily={samples} />
            <div className="sleep-legend"><span><i style={{ background: SLEEP_COLORS.Profondo }} />{t('sleep.deep')}</span><span><i style={{ background: SLEEP_COLORS.Leggero }} />{t('sleep.light')}</span><span><i style={{ background: SLEEP_COLORS.REM }} />{t('sleep.rem')}</span></div>
          </article>
        </section>

        <section className="planning-grid" id="plan" aria-label={t('plan.label')}>
          <article className="panel plan-panel"><div className="panel-heading"><div><h2>{t('plan.title')}<span className="tiny-label">{t('plan.personal')}</span></h2><p>{t('plan.subtitle')}</p></div><button className="button secondary add-session" onClick={() => setSessionForm(true)} disabled={!canEditPlan}><Plus size={16} /><span>{t('plan.newSession')}</span></button></div>
            <div className="week-toolbar"><strong>{formatDay(days[0], { day: 'numeric' })} – {formatDay(days[6], { day: 'numeric', month: 'long' })}</strong><span className="week-total">{t('plan.sessions', { count: weeklySessions.length })} <i />{durationLabel(plannedMinutes)}</span><div className="week-buttons"><button className="icon-button" aria-label={t('plan.previousWeek')} onClick={() => setSelectedDay(shiftDay(selectedDay, -7))}><ChevronLeft size={17} /></button><button className="today-button" onClick={() => setSelectedDay(currentDay)}>{t('plan.today')}</button><button className="icon-button" aria-label={t('plan.nextWeek')} onClick={() => setSelectedDay(shiftDay(selectedDay, 7))}><ChevronRight size={17} /></button></div></div>
            <div className="week-days">{days.map((day) => <button key={day} onClick={() => setSelectedDay(day)} aria-pressed={day === selectedDay} aria-label={formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' })} className={`${day === selectedDay ? 'selected' : ''} ${day === currentDay ? 'is-today' : ''}`}><span>{formatDay(day, { weekday: 'short' })}</span><strong>{formatDay(day, { day: 'numeric' })}</strong><i className={sessions.some((session) => session.date === day) ? 'has-session' : ''} /></button>)}</div>
            <div className="session-list">{selectedSessions.length ? selectedSessions.map((session) => {
              const Icon = SPORT_ICONS[session.sport] || Activity;
              return <div className={`session-item ${session.status === 'completed' ? 'completed' : ''}`} key={session.id}><span className={`session-sport sport-${session.sport}`}><Icon size={21} /></span><div className="session-copy"><h3>{session.title}</h3><p>{t(SPORT_LABELS[session.sport])}<span>·</span><Clock3 size={12} />{durationLabel(session.durationMinutes)}{session.time && <><span>·</span>{session.time}</>}</p>{session.notes && <div className="session-note">{session.notes}</div>}</div><button className={`completion-button ${session.status === 'completed' ? 'checked' : ''}`} disabled={busySession === session.id} onClick={() => toggleCompleted(session)} aria-label={t(session.status === 'completed' ? 'plan.markPlanned' : 'plan.complete', { title: session.title })} aria-pressed={session.status === 'completed'}>{busySession === session.id ? <LoaderCircle size={16} className="spin" /> : <Check size={15} />}</button><button className="icon-button delete-button" onClick={() => setDeleteTarget(session)} aria-label={t('plan.delete', { title: session.title })}><Trash2 size={15} /></button></div>;
            }) : <div className="plan-empty"><span><CalendarDays size={24} /></span><div><strong>{t('plan.emptyTitle')}</strong><p>{t('plan.emptyDescription', { date: formatDay(selectedDay, { day: 'numeric', month: 'long' }) })}</p></div><button className="text-button" disabled={!canEditPlan} onClick={() => setSessionForm(true)}>{t('plan.add')} <ArrowRight size={14} /></button></div>}</div>
            <div className="plan-footer"><ShieldCheck size={14} />{t('plan.footer')}</div>
          </article>

        <TrainingLoad sessions={data?.activities.sessions || []} endDay={currentDay} range={dashboard.activityRange} page={dashboard.activityPage} onPageChange={dashboard.setActivityPage} loading={loading || (syncing && !data?.activities.complete)} unavailable={Boolean(error) || !data?.activities.complete} />
        </section>
        <footer className="page-footer"><span>garmin<span>trainer</span></span><p>{t('footer.tagline')}</p><span className="local-footer"><CircleCheck size={13} />{error ? t('storage.unavailable') : data?.storage.ready ? t('storage.ready') : t('storage.connecting')}</span></footer>
      </main>
    </div>
    {notice && <div className="toast" role="status"><CircleCheck size={17} /><span>{messageText(notice)}</span><button className="icon-button" onClick={() => setNotice('')} aria-label={t('notices.close')}><X size={16} /></button></div>}
    {sessionForm && <SessionForm date={selectedDay} onClose={() => setSessionForm(false)} onSave={saveSession} />}
    {profile && (profileDialog || profile.needsCompletion) && <ProfileModal key={profile.id} profile={profile} garminStatusKey={garminStatusKey} required={profile.needsCompletion} onClose={() => setProfileDialog(null)} onSave={async (id, values) => { await dashboard.saveProfile(id, values); setProfileDialog(null); setNotice({ key: 'notices.profileSaved' }); }} />}
    {settingsOpen && <SettingsModal profile={profile} onClose={() => setSettingsOpen(false)} onProfiles={() => { setSettingsOpen(false); setProfileDialog('form'); }} onSave={async (id, theme) => { await dashboard.saveTheme(id, theme); setNotice({ key: 'notices.settingsSaved' }); }} />}
    {deleteTarget && <Modal title={t('session.deleteTitle')} subtitle={t('session.deleteSubtitle', { title: deleteTarget.title })} onClose={deleting ? () => {} : () => setDeleteTarget(null)}><div className="modal-actions"><button className="button secondary" disabled={deleting} onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button><button className="button danger" disabled={deleting} onClick={removeSession}>{deleting ? t('common.deleting') : t('session.delete')}</button></div></Modal>}
  </div>;
}
