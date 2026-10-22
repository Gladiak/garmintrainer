import { useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react';
import UserAvatar from './UserAvatar';

export const PRIMARY_SPORT_LABELS = { running: 'Corsa', cycling: 'Bici', swimming: 'Nuoto', gym: 'Palestra', hiit: 'HIIT' };
export const profileName = (profile) => [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || 'Profilo da completare';

export default function ProfileForm({ profile, onBack, onSave, onBusyChange }) {
  const editingId = profile?.id || null;
  const [firstName, setFirstName] = useState(profile?.firstName || '');
  const [lastName, setLastName] = useState(profile?.lastName || '');
  const [primarySport, setPrimarySport] = useState(profile?.primarySport || '');
  const [avatar, setAvatar] = useState(profile?.avatar || null);
  const [readingAvatar, setReadingAvatar] = useState(false);
  const avatarInput = useRef(null);
  const avatarReader = useRef(null);
  const [apiKey, setApiKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = busy || readingAvatar;

  useEffect(() => { onBusyChange(locked); }, [locked, onBusyChange]);

  useEffect(() => () => {
    if (avatarReader.current) {
      avatarReader.current.onload = null; avatarReader.current.onerror = null; avatarReader.current.abort();
    }
  }, []);

  function chooseAvatar(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size) {
      setError('Scegli un’immagine JPG, PNG o WebP, fino a 5 MB.'); return;
    }
    const reader = new FileReader();
    avatarReader.current = reader; setReadingAvatar(true); setError('');
    reader.onload = () => { setAvatar(reader.result); setReadingAvatar(false); };
    reader.onerror = () => { setError('Impossibile leggere questa immagine. Scegli un altro file.'); setReadingAvatar(false); };
    reader.readAsDataURL(file);
  }

  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await onSave(editingId, { firstName, lastName, primarySport,
        ...(avatar !== (profile?.avatar || null) ? { avatar } : {}),
        ...(removeKey ? { apiKey: null } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
      setApiKey(''); onBack();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <>
    <form className="session-form profile-form" onSubmit={save}>
      <fieldset disabled={locked}>
        <div className="profile-photo-editor">
          <div role="img" aria-label={avatar ? 'Anteprima della foto del profilo' : 'Avatar con le iniziali'}><UserAvatar profile={{ firstName, lastName, avatar }} className="profile-photo" /></div>
          <div className="profile-photo-controls"><strong>Foto del profilo</strong>
            <div className="profile-photo-actions"><button type="button" className="button secondary" onClick={() => avatarInput.current?.click()}>{readingAvatar ? <LoaderCircle size={15} className="spin" /> : <Camera size={15} />}{readingAvatar ? 'Caricamento…' : avatar ? 'Cambia foto' : 'Carica foto'}</button>
              {avatar && <button type="button" className="text-button" onClick={() => { setAvatar(null); setError(''); }}><Trash2 size={14} />Rimuovi foto</button>}</div>
            <p id="avatar-help">JPG, PNG o WebP · massimo 5 MB. La foto viene centrata e salvata con il profilo.</p>
            <input ref={avatarInput} className="avatar-file-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Scegli foto del profilo" aria-describedby="avatar-help" onChange={chooseAvatar} />
          </div>
        </div>
        <div className="form-grid"><label>Nome<input name="firstName" autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} required maxLength={80} /></label>
          <label>Cognome<input name="lastName" autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} required maxLength={80} /></label></div>
        <label>Sport principale<select name="primarySport" value={primarySport} onChange={(event) => setPrimarySport(event.target.value)} required><option value="" disabled>Scegli uno sport</option>{Object.entries(PRIMARY_SPORT_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Chiave API personale Garmin<input name="garminApiKey" type="password" autoComplete="new-password" spellCheck={false} value={apiKey} onChange={(event) => { setApiKey(event.target.value); setRemoveKey(false); }} disabled={removeKey} maxLength={8192} placeholder={profile?.hasGarminKey ? 'Chiave già salvata · lascia vuoto per mantenerla' : 'Inserisci la tua chiave personale'} aria-describedby="garmin-key-help" /></label>
        <p id="garmin-key-help" className="credential-help">Usa la chiave personale del portale Garmin. Il collegamento e il rinnovo dell’accesso sono automatici. Puoi aggiungere la chiave anche in seguito.</p>
        {profile?.hasGarminKey && <label className="remove-key"><input type="checkbox" checked={removeKey} onChange={(event) => { setRemoveKey(event.target.checked); setApiKey(''); }} />Rimuovi la chiave Garmin salvata</label>}
      </fieldset>
      {profile?.needsCompletion && <p className="profile-migration-note">La configurazione precedente è stata conservata. Completa nome, cognome e sport per personalizzare questo profilo.</p>}
      <p className="profile-privacy"><ShieldCheck size={16} />La chiave viene cifrata nell’archivio locale e non viene restituita al browser. Ogni profilo mantiene il proprio piano.</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" disabled={locked} onClick={onBack}>Annulla</button><button type="submit" className="button primary" disabled={locked}>{locked && <LoaderCircle size={16} className="spin" />}{readingAvatar ? 'Caricamento…' : busy ? 'Salvataggio…' : editingId ? 'Salva profilo' : 'Crea profilo'}</button></div>
    </form>
  </>;
}
