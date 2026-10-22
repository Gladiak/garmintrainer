import { messageText } from '../lib/i18n';
import { useTranslation } from '../hooks/useTranslation';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, LayoutDashboard, LoaderCircle, Palette, Plus, X } from 'lucide-react';
import catalog from '../../../shared/dashboard-modules.json';
import Modal from './Modal';
import ThemePicker from './ThemePicker';
import { useTheme } from './ThemeProvider';
import { profileName } from './ProfileForm';
import { DEFAULT_THEME_ID } from '../lib/palette';

export default function SettingsModal({ profile, layout, onSaveLayout, onSave, onClose, onProfiles }) {
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
  const [layoutView, setLayoutView] = useState('overview');
  const modules = draftSections[layoutView];
  const availableTypes = Object.entries(catalog).filter(([, definition]) => definition.sections.includes(layoutView));
  function setModules(update) {
    setDraftSections(previous => ({ ...previous, [layoutView]: typeof update === 'function' ? update(previous[layoutView]) : update }));
  }
  const [newType, setNewType] = useState('heart-rate');
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
    try { await onSaveLayout({ version: 2, sections: draftSections }); onClose(); }
    catch (failure) { setError(failure); setBusy(false); }
  }
  function moveModule(index, direction) {
    setModules(previous => {
      const next = [...previous];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
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
  return <Modal className="settings-modal" title={t('nav.settings')} onClose={busy ? () => {} : onClose}>
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
        <form className="session-form" onSubmit={saveDashboard}>
          <p className="modal-subtitle">{t('modules.layoutHelp')}</p>
          <fieldset disabled={busy} className="layout-editor">
            <label>{t('modules.layoutSection')}<select value={layoutView} onChange={event => { setLayoutView(event.target.value); if (!catalog[newType].sections.includes(event.target.value)) setNewType('heart-rate'); }}>{['overview', 'wellness'].map(view => <option key={view} value={view}>{t(`nav.${view}`)}</option>)}</select></label>
            <ol className="layout-module-list">{modules.map((module, index) => <li key={module.id}><span>{t(catalog[module.type].label)}<small>{t(catalog[module.type].size === 'compact' ? 'modules.card' : 'modules.panel')}</small></span><div>
              <button type="button" className="icon-button" disabled={index === 0} onClick={() => moveModule(index, -1)} aria-label={t('modules.moveUp')}><ArrowUp size={15} /></button>
              <button type="button" className="icon-button" disabled={index === modules.length - 1} onClick={() => moveModule(index, 1)} aria-label={t('modules.moveDown')}><ArrowDown size={15} /></button>
              <button type="button" className="icon-button" onClick={() => setModules(previous => previous.filter(item => item.id !== module.id))} aria-label={t('modules.remove')}><X size={15} /></button>
            </div></li>)}</ol>
            <div className="layout-add-module"><select value={newType} onChange={event => setNewType(event.target.value)} aria-label={t('modules.add')}>{availableTypes.map(([type, definition]) => <option key={type} value={type}>{t(definition.label)} · {t(definition.size === 'compact' ? 'modules.card' : 'modules.panel')}</option>)}</select><button type="button" className="button secondary" disabled={modules.length >= 12} onClick={() => setModules(previous => [...previous, { id: crypto.randomUUID(), type: newType }])}><Plus size={15} />{t('modules.add')}</button></div>
          </fieldset>
          {error && <p role="alert" className="form-error">{messageText(error)}</p>}
          <div className="modal-actions"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>{t('common.cancel')}</button><button className="button primary" type="submit" disabled={busy}>{busy && <LoaderCircle size={16} className="spin" />}{t('modules.saveLayout')}</button></div>
        </form>
      </section>
    </div>
  </Modal>;
}
