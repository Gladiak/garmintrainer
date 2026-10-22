import { DEFAULT_LANGUAGE, LANGUAGES, i18n, messageText, t, translationError } from '../lib/i18n';
import { useTranslation } from '../hooks/useTranslation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Camera, Link2, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react';
import UserAvatar from './UserAvatar';

export const PRIMARY_SPORT_LABELS = { running: 'sports.running', cycling: 'sports.cycling', swimming: 'sports.swimming', gym: 'sports.gym', hiit: 'sports.hiit' };
export const profileName = (profile) => [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || t('profile.incomplete');

export default function ProfileForm({ profile, garminStatusKey = 'connection.linkGarmin', activeProfileId, onBack, onSave, onBusyChange, required = false }) {
  useTranslation();
  const editingId = profile?.id || null;
  const [firstName, setFirstName] = useState(profile?.firstName || '');
  const [lastName, setLastName] = useState(profile?.lastName || '');
  const [primarySport, setPrimarySport] = useState(profile?.primarySport || '');
  const [language, setLanguage] = useState(profile?.language || DEFAULT_LANGUAGE);
  const canPreviewLanguage = !profile || profile.id === activeProfileId;
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
  useLayoutEffect(() => {
    if (!canPreviewLanguage) return;
    i18n.previewLanguage(language);
    return () => i18n.clearPreview();
  }, [language, canPreviewLanguage]);

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
      setError(translationError('errors.INVALID_AVATAR')); return;
    }
    const reader = new FileReader();
    avatarReader.current = reader; setReadingAvatar(true); setError('');
    reader.onload = () => { setAvatar(reader.result); setReadingAvatar(false); };
    reader.onerror = () => { setError(translationError('errors.avatarRead')); setReadingAvatar(false); };
    reader.readAsDataURL(file);
  }

  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await onSave(editingId, { firstName, lastName, primarySport, language,
        ...(avatar !== (profile?.avatar || null) ? { avatar } : {}),
        ...(removeKey ? { apiKey: null } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
      setApiKey(''); onBack();
    } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  return <>
    <form className="session-form profile-form" onSubmit={save}>
      <fieldset disabled={locked}>
        <div className="profile-photo-editor">
          <div role="img" aria-label={avatar ? t('profile.photoPreview') : t('profile.initialsAvatar')}><UserAvatar profile={{ firstName, lastName, avatar }} className="profile-photo" /></div>
          <div className="profile-photo-controls"><strong>{t('profile.photo')}</strong>
            <div className="profile-photo-actions"><button type="button" className="button secondary" onClick={() => avatarInput.current?.click()}>{readingAvatar ? <LoaderCircle size={15} className="spin" /> : <Camera size={15} />}{readingAvatar ? t('common.loading') : avatar ? t('profile.changePhoto') : t('profile.uploadPhoto')}</button>
              {avatar && <button type="button" className="text-button" onClick={() => { setAvatar(null); setError(''); }}><Trash2 size={14} />{t('profile.removePhoto')}</button>}</div>
            <p id="avatar-help">{t('profile.photoHelp')}</p>
            <input ref={avatarInput} className="avatar-file-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label={t('profile.choosePhoto')} aria-describedby="avatar-help" onChange={chooseAvatar} />
          </div>
        </div>
        <div className="form-grid"><label>{t('profile.firstName')}<input name="firstName" autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} required maxLength={80} /></label>
          <label>{t('profile.lastName')}<input name="lastName" autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} required maxLength={80} /></label></div>
        <label>{t('profile.sport')}<select name="primarySport" value={primarySport} onChange={(event) => setPrimarySport(event.target.value)} required><option value="" disabled>{t('profile.chooseSport')}</option>{Object.entries(PRIMARY_SPORT_LABELS).map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}</select></label>
        <label>{t('profile.language')}<select name="language" value={language} onChange={(event) => setLanguage(event.target.value)} aria-describedby="language-help">{LANGUAGES.map(({ code }) => <option key={code} value={code}>{t(`languages.${code}`)}</option>)}</select></label>
        <p id="language-help" className="credential-help">{t(canPreviewLanguage ? 'profile.languageHelp' : 'profile.inactiveLanguageHelp')}</p>
        <label>{t('profile.apiKey')}<input name="garminApiKey" type="password" autoComplete="new-password" spellCheck={false} value={apiKey} onChange={(event) => { setApiKey(event.target.value); setRemoveKey(false); }} disabled={removeKey} maxLength={8192} placeholder={profile?.hasGarminKey ? t('profile.savedKey') : t('profile.enterKey')} aria-describedby="garmin-key-help" /></label>
        <p id="garmin-key-help" className="credential-help">{t('profile.keyHelp')}</p>
        {profile?.hasGarminKey && <label className="remove-key"><input type="checkbox" checked={removeKey} onChange={(event) => { setRemoveKey(event.target.checked); setApiKey(''); }} />{t('profile.removeKey')}</label>}
        <p className="profile-garmin-status" role="status"><Link2 size={16} aria-hidden="true" /><span>{t('profile.garminStatus')}: <strong>{t(garminStatusKey)}</strong></span></p>
      </fieldset>

      <p className="profile-privacy"><ShieldCheck size={16} />{t('profile.privacy')}</p>
      {error && <p role="alert" className="form-error">{messageText(error)}</p>}
      <div className="modal-actions">{!required && <button type="button" className="button secondary" disabled={locked} onClick={onBack}>{t('common.cancel')}</button>}<button type="submit" className="button primary" disabled={locked}>{locked && <LoaderCircle size={16} className="spin" />}{readingAvatar ? t('common.loading') : busy ? t('common.saving') : editingId ? t('profile.save') : t('page.createAction')}</button></div>
    </form>
  </>;
}
