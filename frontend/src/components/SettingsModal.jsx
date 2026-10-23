import { messageText } from '../lib/i18n';
import { useTranslation } from '../hooks/useTranslation';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { LayoutDashboard, LoaderCircle, Palette } from 'lucide-react';
import DashboardLayoutEditor from './dashboard/DashboardLayoutEditor';
import Modal from './Modal';
import ThemePicker from './ThemePicker';
import { useTheme } from './ThemeProvider';
import { profileName } from './ProfileForm';
import { DEFAULT_THEME_ID } from '../lib/palette';

export default function SettingsModal({ profile, layout, onSaveLayout, onSave, onClose, onProfiles, initialView = 'overview' }) {
  const { t } = useTranslation();
  const [section, setSection] = useState('theme');
  const sectionId = useId();
  const navigation = useRef(null);
  const sections = [
    { id: 'theme', label: 'settings.theme', icon: Palette },
    { id: 'dashboard', label: 'settings.customizeDashboard', icon: LayoutDashboard },
  ];
  const [themeId, setThemeId] = useState(profile?.theme || DEFAULT_THEME_ID);
  const [darkMode, setDarkMode] = useState(Boolean(profile?.darkMode));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draftSections, setDraftSections] = useState(layout?.sections || { overview: [], wellness: [] });
  const draftInitialized = useRef(Boolean(layout));
  useEffect(() => {
    if (layout && !draftInitialized.current) {
      setDraftSections(layout.sections);
      draftInitialized.current = true;
    }
  }, [layout]);
  const { previewTheme, clearPreview } = useTheme();
  useLayoutEffect(() => { previewTheme(themeId, darkMode); }, [themeId, darkMode, previewTheme]);
  useEffect(() => () => clearPreview(), [clearPreview]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSave(profile.id, themeId, darkMode); onClose(); }
    catch (failure) { setError(failure); setBusy(false); }
  }
  async function saveDashboard(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSaveLayout({ version: 3, sections: draftSections }); onClose(); }
    catch (failure) { setError(failure); setBusy(false); }
  }
  function navigateSections(event) {
    const index = sections.findIndex(item => item.id === section);
    const next = {
      ArrowDown: (index + 1) % sections.length,
      ArrowUp: (index + sections.length - 1) % sections.length,
      Home: 0,
      End: sections.length - 1,
    }[event.key];
    if (next === undefined || busy) return;
    event.preventDefault();
    setSection(sections[next].id);
    navigation.current.querySelectorAll('[role="tab"]')[next]?.focus();
  }
  return <Modal className="settings-modal settings-layout-modal" title={t('nav.settings')} onClose={busy ? () => {} : onClose}>
    <div className="settings-layout">
      <nav className="settings-navigation" role="tablist" aria-label={t('settings.sections')} aria-orientation="vertical" ref={navigation} onKeyDown={navigateSections}>
        {sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" id={`${sectionId}-${id}-tab`} aria-controls={`${sectionId}-${id}-panel`} aria-selected={section === id} tabIndex={section === id ? 0 : -1} disabled={busy} className="settings-section-button" onClick={() => setSection(id)}>
          <Icon size={18} aria-hidden="true" /><span>{t(label)}</span>
        </button>)}
      </nav>
      <section className="settings-panel" id={`${sectionId}-theme-panel`} role="tabpanel" aria-labelledby={`${sectionId}-theme-tab`} hidden={section !== 'theme'} tabIndex={0}>
        {profile ? <form className="session-form settings-form" onSubmit={save}>
          <p className="modal-subtitle">{t('settings.subtitle')}</p>
          <div className="settings-profile-note"><Palette size={18} /><span>{t('settings.profileTheme', { name: profileName(profile) })}</span></div>
          <fieldset disabled={busy}><ThemePicker value={themeId} onChange={setThemeId} />
            <label className="theme-mode-toggle"><span><strong>{t('themes.darkMode')}</strong><small>{t('themes.darkModeHelp')}</small></span><input type="checkbox" role="switch" checked={darkMode} onChange={event => setDarkMode(event.target.checked)} /></label>
          </fieldset>
          {error && <p role="alert" className="form-error">{messageText(error)}</p>}
          <div className="modal-actions"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>{t('common.cancel')}</button><button className="button primary" type="submit" disabled={busy}>{busy && <LoaderCircle size={16} className="spin" />}{busy ? t('common.saving') : t('settings.save')}</button></div>
        </form> : <div className="profile-list-empty"><Palette size={28} /><strong>{t('settings.emptyTitle')}</strong><p>{t('settings.emptyHint')}</p><button className="button primary" onClick={onProfiles}>{t('settings.openProfiles')}</button></div>}
      </section>
      <section className="settings-panel" id={`${sectionId}-dashboard-panel`} role="tabpanel" aria-labelledby={`${sectionId}-dashboard-tab`} hidden={section !== 'dashboard'} tabIndex={0}>
        <form className="session-form layout-settings-form" onSubmit={saveDashboard}>
          <p className="modal-subtitle">{t('modules.layoutHelp')}</p>
          <fieldset disabled={busy || !layout} className="layout-editor">
            <DashboardLayoutEditor sections={draftSections} onChange={setDraftSections} disabled={busy || !layout} initialView={initialView} />
          </fieldset>
          {error && <p role="alert" className="form-error">{messageText(error)}</p>}
          <div className="modal-actions"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>{t('common.cancel')}</button><button className="button primary" type="submit" disabled={busy || !layout}>{busy && <LoaderCircle size={16} className="spin" />}{t('modules.saveLayout')}</button></div>
        </form>
      </section>
    </div>
  </Modal>;
}
