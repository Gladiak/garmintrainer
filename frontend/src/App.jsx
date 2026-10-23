import { messageText, setProfileLanguage } from './lib/i18n';
import { useTranslation } from './hooks/useTranslation';
import { useEffect, useLayoutEffect, useState } from 'react';
import {
  Activity, ArrowUpRight, CalendarDays, ChevronRight, CircleCheck,
  HeartPulse, Info, LayoutDashboard, Link2, Menu, RefreshCw, ShieldCheck, X,
} from 'lucide-react';
import { useDashboard } from './hooks/useDashboard';
import { shiftDay } from './lib/dates';
import PeriodNavigation from './components/PeriodNavigation';
import DashboardModules from './components/DashboardModules';
import PlannerPanel from './components/PlannerPanel';
import ProfileModal, { profileName, PRIMARY_SPORT_LABELS } from './components/ProfileModal';
import SettingsModal from './components/SettingsModal';
import SidebarAccountMenu from './components/SidebarAccountMenu';
import { useTheme } from './components/ThemeProvider';

export default function App({ user, onLogout }) {
  const { t } = useTranslation();
  const { setProfileTheme } = useTheme();
  const [activeNav, setActiveNav] = useState(() => ['overview', 'wellness', 'plan'].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'overview');
  const dashboard = useDashboard(activeNav);
  const { data, loading, syncing, error, garminConnection, period, setPeriod, endDay, visibleFrom, currentDay } = dashboard;
  const [profileDialog, setProfileDialog] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const changed = () => { const view = window.location.hash.slice(1); setActiveNav(['overview', 'wellness', 'plan'].includes(view) ? view : 'overview'); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const [notice, setNotice] = useState('');
  const garmin = data?.garmin;
  const garminStatusKey = error ? 'connection.backendUnavailable' : loading && !data ? 'page.connecting' : garminConnection.connecting ? 'connection.connectingGarmin' : garminConnection.error ? 'connection.checkGarmin' : garmin?.valid ? 'connection.garminReady' : garmin?.configured ? 'connection.garminConfigured' : 'connection.linkGarmin';
  const profile = data?.profile;
  useLayoutEffect(() => {
    if (profile) setProfileTheme(profile.theme, profile.id, profile.darkMode);
    else if (!loading) setProfileTheme();
  }, [profile?.id, profile?.theme, profile?.darkMode, loading, setProfileTheme]);
  useLayoutEffect(() => {
    if (profile) setProfileLanguage(profile.language, profile.id);
    else if (!loading) setProfileLanguage();
  }, [profile?.id, profile?.language, loading]);
  useEffect(() => {
    setNotice('');
  }, [dashboard.profileId]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);

  function navigate(name) { setActiveNav(name); setMenuOpen(false); }
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
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label={t('nav.open')} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Menu size={21} /></button><span>{profile?.firstName || t('nav.yourSpace')}</span><ChevronRight size={13} /><strong>{t(`nav.${activeNav === 'overview' ? 'overview' : activeNav === 'wellness' ? 'wellness' : 'plan'}`)}</strong></div></header>

      <main id="main-content">
        <section className="page-heading" id={activeNav}>
          <div className="page-heading-copy"><h1>{t(activeNav === 'overview' ? 'page.heading' : activeNav === 'wellness' ? 'health.pageTitle' : 'plan.title')}<span>.</span></h1><p>{t(activeNav === 'overview' ? 'page.subtitle' : activeNav === 'wellness' ? 'health.pageSubtitle' : 'plan.subtitle')}</p></div>
          {activeNav !== 'plan' && <div className="heading-actions dashboard-toolbar">
            <div className="dashboard-refresh-period"><button className="button secondary refresh-button" onClick={dashboard.reload} disabled={loading || syncing} title={t('page.refreshLabel')} aria-label={t('page.refreshLabel')}><RefreshCw size={16} className={loading || syncing ? 'spin' : ''} /></button>
              <button type="button" className="today-button toolbar-today" aria-pressed={endDay === currentDay} onClick={dashboard.resetPeriod}>{t('plan.today')}</button>
              {activeNav === 'wellness' && <select className="period-select" aria-label={t('trend.period')} value={period} onChange={event => setPeriod(Number(event.target.value))}>{[1, 7, 14, 30].map(count => <option key={count} value={count}>{count === 1 ? t('modules.oneDay') : t('trend.lastDays', { count })}</option>)}</select>}
            </div>
            <PeriodNavigation from={visibleFrom} to={endDay} min={shiftDay(currentDay, -90 + period)} max={currentDay}
              onSelect={dashboard.setAnchorDate} onPrevious={() => dashboard.shiftPeriod(-1)} onNext={() => dashboard.shiftPeriod(1)}
              isCurrent={endDay === currentDay} previousDisabled={shiftDay(endDay, -(period * 2 - 1)) < shiftDay(currentDay, -89)} nextDisabled={shiftDay(endDay, period) > currentDay} />
          </div>}
        </section>

        {error && <div className="error-banner" role="alert"><Info size={18} /><span>{messageText(error)} {t('page.backendHint')}</span><button onClick={dashboard.reload}>{t('common.retry')}</button></div>}
        {activeNav !== 'plan' && !error && garminConnection.error && <div className="error-banner" role="alert"><Link2 size={18} /><span>{messageText(garminConnection.error)} {t('page.localPlanAvailable')}</span><button onClick={dashboard.reload}>{t('common.retry')}</button></div>}
        {!loading && !error && (!profile || profile.needsCompletion) && <div className="profile-banner"><ShieldCheck size={18} /><p>{profile ? t('page.completeProfile') : t('page.createProfile')}</p><button className="button secondary" onClick={() => setProfileDialog('form')}>{profile ? t('page.completeAction') : t('page.createAction')}</button></div>}

        {activeNav === 'plan' ? <section className="panel planner-page"><PlannerPanel dashboard={dashboard} /></section> : <>{activeNav === 'wellness' && <p className="health-context">{t('health.context')}</p>}<DashboardModules dashboard={dashboard} /></>}
        <footer className="page-footer"><span>garmin<span>trainer</span></span><p>{t('footer.tagline')}</p><span className="local-footer"><CircleCheck size={13} />{error ? t('storage.unavailable') : data?.storage.ready ? t('storage.ready') : t('storage.connecting')}</span></footer>
      </main>
    </div>
    {notice && <div className="toast" role="status"><CircleCheck size={17} /><span>{messageText(notice)}</span><button className="icon-button" onClick={() => setNotice('')} aria-label={t('notices.close')}><X size={16} /></button></div>}
    {profile && (profileDialog || profile.needsCompletion) && <ProfileModal key={profile.id} profile={profile} garminStatusKey={garminStatusKey} required={profile.needsCompletion} onClose={() => setProfileDialog(null)} onSave={async (id, values) => { await dashboard.saveProfile(id, values); setProfileDialog(null); setNotice({ key: 'notices.profileSaved' }); }} />}
    {settingsOpen && <SettingsModal key={profile?.id} initialView={activeNav} layout={data?.layout} onSaveLayout={dashboard.saveLayout} profile={profile} onClose={() => setSettingsOpen(false)} onProfiles={() => { setSettingsOpen(false); setProfileDialog('form'); }} onSave={async (id, theme, darkMode) => { await dashboard.saveTheme(id, theme, darkMode); setNotice({ key: 'notices.settingsSaved' }); }} />}

  </div>;
}
