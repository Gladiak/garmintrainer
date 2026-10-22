import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowRight, ArrowUpRight, BatteryCharging, Bike, CalendarDays,
  Check, ChevronLeft, ChevronRight, CircleCheck, Clock3, Dumbbell, Footprints,
  HeartPulse, Info, LayoutDashboard, Link2, LoaderCircle, Menu, Moon,
  Plus, RefreshCw, Settings2, ShieldCheck, Trash2, UsersRound, ChevronsUpDown, Waves, X, Zap,
} from 'lucide-react';
import { useDashboard } from './hooks/useDashboard';
import { demoData, METRICS } from './lib/demo';
import { today, shiftDay, weekDays, formatDay, durationLabel } from './lib/dates';
import { TrendChart, SleepChart } from './components/Charts';
import SessionForm, { SPORT_LABELS } from './components/SessionForm';
import Modal from './components/Modal';
import ProfileModal, { profileName, PRIMARY_SPORT_LABELS } from './components/ProfileModal';
import SettingsModal from './components/SettingsModal';
import UserAvatar from './components/UserAvatar';
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
  return <article className={`metric-card tone-${tone}`}>
    <div className="metric-top"><span className="metric-icon"><Icon size={18} strokeWidth={1.7} /></span><span className="metric-label">{label}</span>{demo && <span className="example-dot" title="Dato di esempio" aria-label="Dato di esempio" />}</div>
    <div className="metric-body"><div className="metric-value">{value}<span>{unit}</span></div><Sparkline values={values} color={color} /></div>
    <p className="metric-caption">{caption}</p>
  </article>;
}

export default function App() {
  const { metricColors, sleepColors: SLEEP_COLORS, setProfileTheme } = useTheme();
  const dashboard = useDashboard();
  const { data, loading, error, garminConnection } = dashboard;
  const currentDay = today();
  const [demo, setDemo] = useState(false);
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
  const sessions = data?.sessions || [];
  const weeklySessions = sessions.filter((session) => session.date >= days[0] && session.date <= days[6]);
  const selectedSessions = sessions.filter((session) => session.date === selectedDay).sort((a, b) => a.time.localeCompare(b.time));
  const plannedMinutes = weeklySessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const garmin = data?.garmin;
  const garminLabel = error ? 'Backend non disponibile' : garminConnection.connecting ? 'Collegamento Garmin…' : garminConnection.error ? 'Garmin da verificare' : garmin?.valid ? 'Garmin pronto' : garmin?.configured ? 'Garmin configurato' : 'Garmin da collegare';
  const profile = dashboard.profiles.find((item) => item.id === dashboard.profileId);
  useLayoutEffect(() => {
    if (profile) setProfileTheme(profile.theme, profile.id);
    else if (!loading) setProfileTheme();
  }, [profile?.id, profile?.theme, loading, setProfileTheme]);
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
  async function saveSession(values) {
    const session = await dashboard.createSession(values);
    setSelectedDay(session.date); setSessionForm(false); setNotice('Sessione salvata nel tuo piano.');
  }
  async function toggleCompleted(session) {
    setBusySession(session.id);
    try { await dashboard.setSessionStatus(session.id, session.status === 'completed' ? 'planned' : 'completed'); }
    catch (failure) { setNotice(failure.message); }
    finally { setBusySession(null); }
  }
  async function removeSession() {
    setDeleting(true);
    try { await dashboard.deleteSession(deleteTarget.id); setDeleteTarget(null); setNotice('Sessione eliminata dal piano.'); }
    catch (failure) { setNotice(failure.message); }
    finally { setDeleting(false); }
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Vai al contenuto</a>
    {menuOpen && <button className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-label="Chiudi navigazione" />}
    <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="Navigazione principale">
      <a className="brand" href="#overview" onClick={() => navigate('overview')}><span className="brand-mark"><Activity size={24} strokeWidth={2.3} /></span><span>garmin<span className="brand-light">trainer</span><small>IL TUO SPAZIO PERSONALE</small></span></a>
      <div className="sidebar-label">IL TUO PERCORSO</div>
      <nav>
        <a className={activeNav === 'overview' ? 'nav-link active' : 'nav-link'} href="#overview" onClick={() => navigate('overview')}><LayoutDashboard size={18} />Panoramica<span className="nav-indicator" /></a>
        <a className={activeNav === 'wellness' ? 'nav-link active' : 'nav-link'} href="#wellness" onClick={() => navigate('wellness')}><HeartPulse size={18} />Benessere<span className="nav-indicator" /></a>
        <a className={activeNav === 'plan' ? 'nav-link active' : 'nav-link'} href="#plan" onClick={() => navigate('plan')}><CalendarDays size={18} />Il mio piano<span className="nav-indicator" /></a>
      </nav>
      <div className="sidebar-divider" />
      <button className="nav-link settings-link" onClick={() => { setProfileDialog('list'); setMenuOpen(false); }}><UsersRound size={18} />Profili</button>
      <button className="nav-link settings-link" onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}><Settings2 size={18} />Impostazioni</button>
      <div className="sidebar-note"><span className="leaf-mark"><Activity size={23} /></span><h3>Trova il tuo ritmo.</h3><p>Lascia che i dati accompagnino il tuo prossimo passo.</p><a href="#plan" onClick={() => navigate('plan')}>Organizza la settimana <ArrowUpRight size={15} /></a><div className="note-orbit orbit-one" /><div className="note-orbit orbit-two" /></div>
      <button className="sidebar-profile" aria-label="Seleziona profilo locale" onClick={() => { setProfileDialog('list'); setMenuOpen(false); }}><UserAvatar profile={profile} className="avatar" /><div><strong>{profile ? profileName(profile) : 'Crea il tuo profilo'}</strong><span>{PRIMARY_SPORT_LABELS[profile?.primarySport] || 'Archivio locale'}</span></div><ChevronsUpDown size={17} /></button>
    </aside>

    <div className="workspace">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Apri navigazione" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Menu size={21} /></button><span>{profile?.firstName || 'Il tuo spazio'}</span><ChevronRight size={13} /><strong>Panoramica</strong></div><div className="topbar-right"><span className="top-date"><CalendarDays size={15} />{formatDay(currentDay, { day: 'numeric', month: 'long', year: 'numeric' })}</span></div></header>

      <main id="main-content">
        <section className="page-heading" id="overview"><div><div className="eyebrow"><span />IL QUADRO COMPLETO</div><h1>La tua panoramica<span>.</span></h1><p>Ogni allenamento comincia da come stai.</p></div><div className="heading-actions"><button className={`status-pill ${garmin?.configured && !error && !garminConnection.error ? 'configured' : ''}`} onClick={() => setProfileDialog('form')}><i />{loading && !data ? 'Connessione…' : garminLabel}<ChevronRight size={13} /></button><button className="button secondary refresh-button" onClick={dashboard.reload} disabled={loading} aria-label="Aggiorna stato dashboard"><RefreshCw size={16} className={loading ? 'spin' : ''} /><span>Aggiorna stato</span></button></div></section>

        {error && <div className="error-banner" role="alert"><Info size={18} /><span>{error} Le modifiche al piano saranno disponibili quando il server risponderà.</span><button onClick={dashboard.reload}>Riprova</button></div>}
        {!error && garminConnection.error && <div className="error-banner" role="alert"><Link2 size={18} /><span>{garminConnection.error} Il piano locale resta disponibile.</span><button onClick={dashboard.reload}>Riprova</button></div>}
        {!loading && !error && (!profile || profile.needsCompletion) && <div className="profile-banner"><ShieldCheck size={18} /><p>{profile ? 'Completa il profilo: la tua configurazione precedente è stata conservata.' : 'Crea il tuo profilo per organizzare il piano e collegare il tuo Garmin.'}</p><button className="button secondary" onClick={() => setProfileDialog('form')}>{profile ? 'Completa profilo' : 'Crea profilo'}</button></div>}

        <div className={`data-notice ${demo ? 'demo-active' : ''}`}><span className="notice-symbol"><Info size={16} /></span><p>{demo ? <><strong>Modalità anteprima.</strong> I valori fisiologici sono di esempio. Il piano rimane quello reale.</> : <><strong>Il tuo spazio è pronto.</strong> I dati Garmin compariranno dopo la prima importazione.</>}</p><button className="demo-toggle" aria-pressed={demo} onClick={() => setDemo(!demo)}><span className="toggle-track"><span /></span>{demo ? 'Chiudi anteprima' : 'Esplora un’anteprima'}</button></div>

        <section className="metrics-grid" aria-label={demo ? 'Indicatori fisiologici dimostrativi' : 'Indicatori fisiologici, in attesa di importazione'}>
          <MetricCard icon={HeartPulse} label="FC a riposo" value={latest?.restingHeartRate ?? '—'} unit={latest ? 'bpm' : ''} caption={demo ? 'Un riferimento, giorno dopo giorno' : 'In attesa dei primi dati'} values={samples.slice(-12).map((day) => day.restingHeartRate)} tone="sage" color={metricColors.restingHeartRate} demo={demo} />
          <MetricCard icon={Moon} label="Sonno" value={sleepMinutes !== null ? `${Math.floor(sleepMinutes / 60)}h` : '—'} unit={sleepMinutes !== null ? `${sleepMinutes % 60}m` : ''} caption={demo ? 'Il sonno della tua ultima notte' : 'In attesa dei primi dati'} values={samples.slice(-12).map((day) => day.deep + day.light + day.rem)} tone="moss" color={metricColors.hrv} demo={demo} />
          <MetricCard icon={BatteryCharging} label="Body Battery" value={latest?.bodyBattery ?? '—'} unit={latest ? '/ 100' : ''} caption={demo ? 'La tua energia, in prospettiva' : 'In attesa dei primi dati'} values={samples.slice(-12).map((day) => day.bodyBattery)} tone="mist" color={metricColors.bodyBattery} demo={demo} />
          <MetricCard icon={Zap} label="Stress" value={latest?.stress ?? '—'} unit={latest ? '/ 100' : ''} caption={demo ? 'Una vista sul carico quotidiano' : 'In attesa dei primi dati'} values={samples.slice(-12).map((day) => day.stress)} tone="sand" color={metricColors.bodyBattery} demo={demo} />
        </section>

        <section className="wellness-grid" id="wellness" aria-label="Andamento del benessere">
          <article className="panel trend-panel"><div className="panel-heading"><div><h2>Ascolta il tuo andamento</h2><p>Piccoli segnali, osservati nel tempo.</p></div><select className="period-select" aria-label="Periodo del grafico" value={period} onChange={(event) => setPeriod(Number(event.target.value))}><option value={7}>Ultimi 7 giorni</option><option value={14}>Ultimi 14 giorni</option><option value={30}>Ultimi 30 giorni</option></select></div><div className="trend-toolbar"><div className="metric-tabs" role="group" aria-label="Metrica da visualizzare">{Object.entries(METRICS).map(([key, config]) => <button key={key} aria-pressed={metric === key} className={metric === key ? 'selected' : ''} onClick={() => setMetric(key)}>{config.label}</button>)}</div><div className="trend-current"><strong>{latest?.[metric] ?? '—'}</strong><span>{latest ? metricConfig.unit : ''}</span></div></div><TrendChart daily={samples} metric={metric} days={period} /><div className="chart-footnote"><span><i style={{ background: metricColors[metric] }} />{metricConfig.label}</span><span>{demo ? 'Dati dimostrativi · nessuna valutazione fisiologica' : 'Nessuna misurazione importata'}</span></div></article>
          <article className="panel sleep-panel"><div className="panel-heading"><div><h2>Le tue notti</h2><p>La composizione del sonno.</p></div><span className="soft-icon moss"><Moon size={19} /></span></div><div className="sleep-summary"><strong>{sleepMinutes !== null ? `${Math.floor(sleepMinutes / 60)}h ${sleepMinutes % 60}m` : '—'}</strong><span>{demo ? 'ultima notte · esempio' : 'in attesa dei dati'}</span></div><SleepChart daily={samples} /><div className="sleep-legend"><span><i style={{ background: SLEEP_COLORS.Profondo }} />Profondo</span><span><i style={{ background: SLEEP_COLORS.Leggero }} />Leggero</span><span><i style={{ background: SLEEP_COLORS.REM }} />REM</span></div></article>
        </section>

        <section className="planning-grid" id="plan" aria-label="Piano di allenamento locale">
          <article className="panel plan-panel"><div className="panel-heading"><div><h2>Il tuo piano<span className="tiny-label">SOLO TUO</span></h2><p>Una settimana alla volta. Con spazio per il recupero.</p></div><button className="button secondary add-session" onClick={() => setSessionForm(true)} disabled={!data?.profile || loading || Boolean(error)}><Plus size={16} /><span>Nuova sessione</span></button></div>
            <div className="week-toolbar"><strong>{formatDay(days[0], { day: 'numeric' })} – {formatDay(days[6], { day: 'numeric', month: 'long' })}</strong><span className="week-total">{weeklySessions.length} {weeklySessions.length === 1 ? 'sessione' : 'sessioni'} <i />{durationLabel(plannedMinutes)}</span><div className="week-buttons"><button className="icon-button" aria-label="Settimana precedente" onClick={() => setSelectedDay(shiftDay(selectedDay, -7))}><ChevronLeft size={17} /></button><button className="today-button" onClick={() => setSelectedDay(currentDay)}>Oggi</button><button className="icon-button" aria-label="Settimana successiva" onClick={() => setSelectedDay(shiftDay(selectedDay, 7))}><ChevronRight size={17} /></button></div></div>
            <div className="week-days">{days.map((day) => <button key={day} onClick={() => setSelectedDay(day)} aria-pressed={day === selectedDay} aria-label={formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' })} className={`${day === selectedDay ? 'selected' : ''} ${day === currentDay ? 'is-today' : ''}`}><span>{formatDay(day, { weekday: 'short' })}</span><strong>{formatDay(day, { day: 'numeric' })}</strong><i className={sessions.some((session) => session.date === day) ? 'has-session' : ''} /></button>)}</div>
            <div className="session-list">{selectedSessions.length ? selectedSessions.map((session) => {
              const Icon = SPORT_ICONS[session.sport] || Activity;
              return <div className={`session-item ${session.status === 'completed' ? 'completed' : ''}`} key={session.id}><span className={`session-sport sport-${session.sport}`}><Icon size={21} /></span><div className="session-copy"><h3>{session.title}</h3><p>{SPORT_LABELS[session.sport]}<span>·</span><Clock3 size={12} />{durationLabel(session.durationMinutes)}{session.time && <><span>·</span>{session.time}</>}</p>{session.notes && <div className="session-note">{session.notes}</div>}</div><button className={`completion-button ${session.status === 'completed' ? 'checked' : ''}`} disabled={busySession === session.id} onClick={() => toggleCompleted(session)} aria-label={session.status === 'completed' ? `Segna da completare: ${session.title}` : `Completa: ${session.title}`} aria-pressed={session.status === 'completed'}>{busySession === session.id ? <LoaderCircle size={16} className="spin" /> : <Check size={15} />}</button><button className="icon-button delete-button" onClick={() => setDeleteTarget(session)} aria-label={`Elimina: ${session.title}`}><Trash2 size={15} /></button></div>;
            }) : <div className="plan-empty"><span><CalendarDays size={24} /></span><div><strong>Lascia spazio al tuo prossimo allenamento.</strong><p>Nessuna sessione per {formatDay(selectedDay, { day: 'numeric', month: 'long' })}. Il tuo piano comincia quando vuoi.</p></div><button className="text-button" disabled={!data?.profile || loading || Boolean(error)} onClick={() => setSessionForm(true)}>Aggiungi una sessione <ArrowRight size={14} /></button></div>}</div>
            <div className="plan-footer"><ShieldCheck size={14} />Il piano è salvato in questa app e non viene inviato al Fenix.</div>
          </article>

          <div className="context-column"><article className="connection-card"><div className="connection-card-top"><span className="connection-small-icon"><Link2 size={19} /></span><span className={`connection-tag ${garmin?.valid && !error && !garminConnection.error ? 'ready' : ''}`}><i />{error ? 'Non disponibile' : garminConnection.connecting ? 'Collegamento…' : garminConnection.error ? 'Da verificare' : garmin?.valid ? 'Accesso pronto' : garmin?.configured ? 'Configurato' : 'Da configurare'}</span></div><h2>Il tuo Garmin.<br />Una nuova prospettiva.</h2><p>{garminConnection.connecting ? 'Stiamo preparando automaticamente il collegamento al tuo Garmin.' : garminConnection.error ? 'Controlla la chiave personale nel profilo oppure aggiorna lo stato per riprovare.' : 'Il collegamento è automatico quando salvi una chiave nel profilo corrente. La prossima importazione porterà qui i tuoi dati reali.'}</p><button className="connection-action" onClick={() => setProfileDialog('form')}>Gestisci collegamento <ArrowUpRight size={16} /></button></article><article className="local-card"><span className="soft-icon"><ShieldCheck size={19} /></span><div><h3>Uno spazio tutto tuo</h3><p>{data?.storage.ready ? 'Le sessioni vengono salvate sul tuo dispositivo, anche senza collegamento a Garmin.' : 'Il piano utilizza l’archivio locale dell’app.'}</p></div></article></div>
        </section>
        <footer className="page-footer"><span>garmin<span>trainer</span></span><p>Il tuo percorso. Al tuo ritmo.</p><span className="local-footer"><CircleCheck size={13} />{error ? 'Archivio non raggiungibile' : data?.storage.ready ? 'Archivio locale pronto' : 'Connessione all’archivio…'}</span></footer>
      </main>
    </div>
    {notice && <div className="toast" role="status"><CircleCheck size={17} /><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="Chiudi notifica"><X size={16} /></button></div>}
    {sessionForm && <SessionForm date={selectedDay} onClose={() => setSessionForm(false)} onSave={saveSession} />}
    {profileDialog && <ProfileModal initialView={profileDialog} profiles={dashboard.profiles} profileId={dashboard.profileId} onClose={() => setProfileDialog(null)} onSave={async (id, values) => { await dashboard.saveProfile(id, values); setNotice('Profilo salvato.'); }} onSelect={dashboard.selectProfile} onDelete={async (id) => { await dashboard.deleteProfile(id); setNotice('Profilo e piano locale eliminati.'); }} />}
    {settingsOpen && <SettingsModal profile={profile} onClose={() => setSettingsOpen(false)} onProfiles={() => { setSettingsOpen(false); setProfileDialog('list'); }} onSave={async (id, theme) => { await dashboard.saveTheme(id, theme); setNotice('Impostazioni salvate.'); }} />}
    {deleteTarget && <Modal title="Eliminare questa sessione?" subtitle={`“${deleteTarget.title}” verrà rimossa dal tuo piano locale.`} onClose={deleting ? () => {} : () => setDeleteTarget(null)}><div className="modal-actions"><button className="button secondary" disabled={deleting} onClick={() => setDeleteTarget(null)}>Annulla</button><button className="button danger" disabled={deleting} onClick={removeSession}>{deleting ? 'Eliminazione…' : 'Elimina sessione'}</button></div></Modal>}
  </div>;
}
