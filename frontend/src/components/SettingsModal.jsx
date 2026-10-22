import { useEffect, useLayoutEffect, useState } from 'react';
import { LoaderCircle, Palette } from 'lucide-react';
import Modal from './Modal';
import ThemePicker from './ThemePicker';
import { useTheme } from './ThemeProvider';
import { profileName } from './ProfileForm';
import { DEFAULT_THEME_ID } from '../lib/palette';

export default function SettingsModal({ profile, onSave, onClose, onProfiles }) {
  const [themeId, setThemeId] = useState(profile?.theme || DEFAULT_THEME_ID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { previewTheme, clearPreview } = useTheme();
  useLayoutEffect(() => { previewTheme(themeId); }, [themeId, previewTheme]);
  useEffect(() => () => clearPreview(), [clearPreview]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSave(profile.id, themeId); onClose(); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <Modal className="settings-modal" title="Impostazioni" subtitle="Personalizza il tuo spazio." onClose={busy ? () => {} : onClose}>
    {profile ? <form className="session-form settings-form" onSubmit={save}>
      <div className="settings-profile-note"><Palette size={18} /><span>Tema di <strong>{profileName(profile)}</strong></span></div>
      <fieldset disabled={busy}><ThemePicker value={themeId} onChange={setThemeId} /></fieldset>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="modal-actions"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Annulla</button><button className="button primary" type="submit" disabled={busy}>{busy && <LoaderCircle size={16} className="spin" />}{busy ? 'Salvataggio…' : 'Salva impostazioni'}</button></div>
    </form> : <div className="profile-list-empty"><Palette size={28} /><strong>Un tema per ogni profilo</strong><p>Crea un profilo locale per salvare la tua preferenza.</p><button className="button primary" onClick={onProfiles}>Apri profili</button></div>}
  </Modal>;
}
