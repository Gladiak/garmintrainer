import { useState } from 'react';
import { Check, ChevronRight, LoaderCircle, Pencil, Plus, Search, Trash2, UsersRound } from 'lucide-react';
import Modal from './Modal';
import UserAvatar from './UserAvatar';
import ProfileForm, { PRIMARY_SPORT_LABELS, profileName } from './ProfileForm';

export { PRIMARY_SPORT_LABELS, profileName } from './ProfileForm';

export default function ProfileModal({ profiles, profileId, initialView = 'list', onClose, onSave, onSelect, onDelete }) {
  // One dialog and view state serve the list, the shared create/edit form and deletion.
  const [view, setView] = useState({ name: initialView, id: initialView === 'form' ? profileId : null });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const profile = profiles.find((item) => item.id === view.id);
  const query = search.trim().toLocaleLowerCase('it');
  const filtered = profiles.filter((item) => `${profileName(item)} ${PRIMARY_SPORT_LABELS[item.primarySport] || ''}`.toLocaleLowerCase('it').includes(query));
  const back = () => { setBusy(false); setError(''); setView({ name: 'list', id: null }); };
  const open = (name, id = null) => { setError(''); setView({ name, id }); };
  async function select(id) {
    if (id === profileId) return;
    setBusy(true); setError('');
    try { await onSelect(id); } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError('');
    try { await onDelete(profile.id); back(); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  const title = view.name === 'list' ? 'Profili locali' : view.name === 'delete' ? 'Eliminare il profilo?' : profile ? 'Modifica profilo' : 'Nuovo profilo';
  return <Modal className="profile-modal" title={title}
    subtitle={view.name === 'list' ? 'Scegli il tuo spazio. Ogni profilo ha dati, piano e collegamento Garmin personali.' : view.name === 'delete' ? 'Questa operazione rimuove i dati salvati su questa installazione.' : 'Dati personali e accesso al tuo Garmin.'}
    focusKey={`${view.name}:${view.id || 'new'}`} onClose={busy ? () => {} : onClose}>
    {view.name === 'list' && <>
      <div className="profile-list-toolbar">
        <label className="profile-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Cerca profili" placeholder="Cerca un profilo…" value={search} onChange={(event) => setSearch(event.target.value)} disabled={busy} /></label>
        <button className="button primary" disabled={busy} onClick={() => open('form')}><Plus size={16} /><span>Nuovo profilo</span></button>
      </div>
      <ul className="profile-list" aria-label="Profili presenti in locale">
        {filtered.map((item) => <li key={item.id} className={`profile-row ${item.id === profileId ? 'is-current' : ''}`}>
          <button className="profile-row-select" disabled={busy} aria-pressed={item.id === profileId} onClick={() => select(item.id)}>
            <UserAvatar profile={item} className="profile-list-avatar" />
            <span className="profile-row-copy"><strong>{profileName(item)}</strong><span>{PRIMARY_SPORT_LABELS[item.primarySport] || 'Profilo da completare'}<span className="profile-row-dot">·</span>{item.hasGarminKey ? 'Garmin configurato' : 'Garmin da collegare'}</span></span>
            {item.id === profileId ? <span className="current-tag"><Check size={12} />Corrente</span> : <ChevronRight className="profile-select-arrow" size={16} />}
          </button>
          <div className="profile-row-actions"><button className="icon-button" disabled={busy} aria-label={`Modifica ${profileName(item)}`} title="Modifica profilo" onClick={() => open('form', item.id)}><Pencil size={17} /></button><button className="icon-button delete-button" disabled={busy} aria-label={`Elimina ${profileName(item)}`} title="Elimina profilo" onClick={() => open('delete', item.id)}><Trash2 size={17} /></button></div>
        </li>)}
      </ul>
      {!filtered.length && <div className="profile-list-empty"><UsersRound size={28} /><strong>{profiles.length ? 'Nessun profilo trovato' : 'Il tuo spazio comincia qui'}</strong><p>{profiles.length ? 'Prova con un altro nome o con lo sport praticato.' : 'Crea il primo profilo con il pulsante qui sopra.'}</p></div>}
      <p className="profile-list-note">{profiles.length} {profiles.length === 1 ? 'profilo locale' : 'profili locali'} · Seleziona una riga per cambiare profilo.</p>
      {busy && <p className="profile-progress" role="status"><LoaderCircle size={15} className="spin" />Cambio profilo…</p>}
    </>}
    {view.name === 'form' && <ProfileForm key={view.id || 'new'} profile={profile} onBack={back} onSave={async (id, values) => { const result = await onSave(id, values); setSearch(''); return result; }} onBusyChange={setBusy} />}
    {view.name === 'delete' && profile && <div className="profile-delete-confirm">
      <div className="profile-delete-summary"><UserAvatar profile={profile} className="profile-list-avatar" /><div><strong>{profileName(profile)}</strong><span>{PRIMARY_SPORT_LABELS[profile.primarySport] || 'Profilo da completare'}</span></div></div>
      <p>Verranno eliminati il profilo, la foto, la chiave Garmin e tutte le sessioni del suo piano locale. L’operazione non può essere annullata.</p>
      <p>I dati presenti su Garmin restano disponibili nel tuo account.</p>
      <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={back}>Annulla</button><button className="button danger" disabled={busy} onClick={remove}>{busy && <LoaderCircle size={16} className="spin" />}{busy ? 'Eliminazione…' : 'Elimina profilo'}</button></div>
    </div>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </Modal>;
}
