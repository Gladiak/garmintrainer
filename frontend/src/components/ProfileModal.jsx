import { messageText } from '../lib/i18n';
import { useTranslation } from '../hooks/useTranslation';
import { useState } from 'react';
import { Check, ChevronRight, LoaderCircle, Pencil, Plus, Search, Trash2, UsersRound } from 'lucide-react';
import Modal from './Modal';
import UserAvatar from './UserAvatar';
import ProfileForm, { PRIMARY_SPORT_LABELS, profileName } from './ProfileForm';

export { PRIMARY_SPORT_LABELS, profileName } from './ProfileForm';

export default function ProfileModal({ profiles, profileId, initialView = 'list', onClose, onSave, onSelect, onDelete }) {
  const { t, locale } = useTranslation();
  // One dialog and view state serve the list, the shared create/edit form and deletion.
  const [view, setView] = useState({ name: initialView, id: initialView === 'form' ? profileId : null });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const profile = profiles.find((item) => item.id === view.id);
  const query = search.trim().toLocaleLowerCase(locale);
  const filtered = profiles.filter((item) => `${profileName(item)} ${t(PRIMARY_SPORT_LABELS[item.primarySport] || 'profile.incomplete')}`.toLocaleLowerCase(locale).includes(query));
  const back = () => { setBusy(false); setError(''); setView({ name: 'list', id: null }); };
  const open = (name, id = null) => { setError(''); setView({ name, id }); };
  async function select(id) {
    if (id === profileId) return;
    setBusy(true); setError('');
    try { await onSelect(id); } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError('');
    try { await onDelete(profile.id); back(); }
    catch (failure) { setError(failure); setBusy(false); }
  }
  const title = view.name === 'list' ? t('profile.listTitle') : view.name === 'delete' ? t('profile.deleteTitle') : profile ? t('profile.editTitle') : t('profile.newTitle');
  return <Modal className="profile-modal" title={title}
    subtitle={view.name === 'list' ? t('profile.listSubtitle') : view.name === 'delete' ? t('profile.deleteSubtitle') : t('profile.formSubtitle')}
    focusKey={`${view.name}:${view.id || 'new'}`} onClose={busy ? () => {} : onClose}>
    {view.name === 'list' && <>
      <div className="profile-list-toolbar">
        <label className="profile-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label={t('profile.search')} placeholder={t('profile.searchPlaceholder')} value={search} onChange={(event) => setSearch(event.target.value)} disabled={busy} /></label>
        <button className="button primary" disabled={busy} onClick={() => open('form')}><Plus size={16} /><span>{t('profile.newTitle')}</span></button>
      </div>
      <ul className="profile-list" aria-label={t('profile.listLabel')}>
        {filtered.map((item) => <li key={item.id} className={`profile-row ${item.id === profileId ? 'is-current' : ''}`}>
          <button className="profile-row-select" disabled={busy} aria-pressed={item.id === profileId} onClick={() => select(item.id)}>
            <UserAvatar profile={item} className="profile-list-avatar" />
            <span className="profile-row-copy"><strong>{profileName(item)}</strong><span>{t(PRIMARY_SPORT_LABELS[item.primarySport] || 'profile.incomplete')}<span className="profile-row-dot">·</span>{item.hasGarminKey ? t('connection.garminConfigured') : t('connection.linkGarmin')}</span></span>
            {item.id === profileId ? <span className="current-tag"><Check size={12} />{t('profile.current')}</span> : <ChevronRight className="profile-select-arrow" size={16} />}
          </button>
          <div className="profile-row-actions"><button className="icon-button" disabled={busy} aria-label={t('profile.editLabel', { name: profileName(item) })} title={t('profile.editTitle')} onClick={() => open('form', item.id)}><Pencil size={17} /></button><button className="icon-button delete-button" disabled={busy} aria-label={t('profile.deleteLabel', { name: profileName(item) })} title={t('profile.delete')} onClick={() => open('delete', item.id)}><Trash2 size={17} /></button></div>
        </li>)}
      </ul>
      {!filtered.length && <div className="profile-list-empty"><UsersRound size={28} /><strong>{profiles.length ? t('profile.noResults') : t('profile.emptyTitle')}</strong><p>{profiles.length ? t('profile.searchHint') : t('profile.emptyHint')}</p></div>}
      <p className="profile-list-note">{t('profile.count', { count: profiles.length })} · {t('profile.selectHint')}</p>
      {busy && <p className="profile-progress" role="status"><LoaderCircle size={15} className="spin" />{t('profile.switching')}</p>}
    </>}
    {view.name === 'form' && <ProfileForm key={view.id || 'new'} profile={profile} activeProfileId={profileId} onBack={back} onSave={async (id, values) => { const result = await onSave(id, values); setSearch(''); return result; }} onBusyChange={setBusy} />}
    {view.name === 'delete' && profile && <div className="profile-delete-confirm">
      <div className="profile-delete-summary"><UserAvatar profile={profile} className="profile-list-avatar" /><div><strong>{profileName(profile)}</strong><span>{t(PRIMARY_SPORT_LABELS[profile.primarySport] || 'profile.incomplete')}</span></div></div>
      <p>{t('profile.deleteWarning')}</p>
      <p>{t('profile.garminPreserved')}</p>
      <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={back}>{t('common.cancel')}</button><button className="button danger" disabled={busy} onClick={remove}>{busy && <LoaderCircle size={16} className="spin" />}{busy ? t('common.deleting') : t('profile.delete')}</button></div>
    </div>}
    {error && <p role="alert" className="form-error">{messageText(error)}</p>}
  </Modal>;
}
