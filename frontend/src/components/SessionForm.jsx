import { useState } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import Modal from './Modal';

export const SPORT_LABELS = { running: 'Corsa', cycling: 'Ciclismo', strength: 'Forza', walking: 'Camminata', mobility: 'Mobilità', swimming: 'Nuoto' };

export default function SessionForm({ date, onClose, onSave }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setSaving(true);
    setError('');
    try { await onSave({ ...values, durationMinutes: Number(values.durationMinutes) }); }
    catch (failure) { setError(failure.message); setSaving(false); }
  }
  return (
    <Modal title="Una nuova sessione" subtitle="Un piccolo impegno con te stesso. Il piano resta in questa app." onClose={saving ? () => {} : onClose}>
      <form onSubmit={submit} className="session-form">
        <label>Nome della sessione<input autoFocus name="title" placeholder="Es. Corsa facile al parco" required maxLength={120} /></label>
        <div className="form-grid">
          <label>Attività<select name="sport" defaultValue="running">{Object.entries(SPORT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Durata (minuti)<input name="durationMinutes" type="number" min="1" max="1440" defaultValue="45" required /></label>
          <label>Data<input name="date" type="date" defaultValue={date} required /></label>
          <label>Orario · facoltativo<input name="time" type="time" /></label>
        </div>
        <label>Note · facoltative<textarea name="notes" rows="3" maxLength={2000} placeholder="Come vuoi affrontare questa sessione?" /></label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>Annulla</button><button className="button primary" disabled={saving}>{saving ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />} {saving ? 'Salvataggio…' : 'Salva sessione'}</button></div>
      </form>
    </Modal>
  );
}
