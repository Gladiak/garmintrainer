import { messageText } from '../lib/i18n';
import { useTranslation } from '../hooks/useTranslation';
import { useState } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import Modal from './Modal';

export const SPORT_LABELS = { running: 'sports.running', cycling: 'sports.cycling', strength: 'sports.strength', walking: 'sports.walking', mobility: 'sports.mobility', swimming: 'sports.swimming' };

export default function SessionForm({ date, onClose, onSave, preview = false }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setSaving(true);
    setError('');
    try { await onSave({ ...values, durationMinutes: Number(values.durationMinutes) }); }
    catch (failure) { setError(failure); setSaving(false); }
  }
  return (
    <Modal title={t('session.title')} subtitle={t(preview ? 'demo.sessionSubtitle' : 'session.subtitle')} onClose={saving ? () => {} : onClose}>
      <form onSubmit={submit} className="session-form">
        <label>{t('session.name')}<input autoFocus name="title" placeholder={t('session.namePlaceholder')} required maxLength={120} /></label>
        <div className="form-grid">
          <label>{t('session.activity')}<select name="sport" defaultValue="running">{Object.entries(SPORT_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
          <label>{t('session.duration')}<input name="durationMinutes" type="number" min="1" max="1440" defaultValue="45" required /></label>
          <label>{t('session.date')}<input name="date" type="date" defaultValue={date} required /></label>
          <label>{t('session.time')}<input name="time" type="time" /></label>
        </div>
        <label>{t('session.notes')}<textarea name="notes" rows="3" maxLength={2000} placeholder={t('session.notesPlaceholder')} /></label>
        {error && <p role="alert" className="form-error">{messageText(error)}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>{t('common.cancel')}</button><button className="button primary" disabled={saving}>{saving ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />} {saving ? t('common.saving') : t('session.save')}</button></div>
      </form>
    </Modal>
  );
}
