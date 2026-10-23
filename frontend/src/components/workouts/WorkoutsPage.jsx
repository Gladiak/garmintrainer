import { useEffect, useState } from 'react';
import { Copy, Dumbbell, LoaderCircle, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { request } from '../../lib/api';
import { messageText } from '../../lib/i18n';
import { useTranslation } from '../../hooks/useTranslation';
import Modal from '../Modal';
import MuscleMap from './MuscleMap';
import WorkoutEditor from './WorkoutEditor';

export default function WorkoutsPage() {
  const { t, locale } = useTranslation();
  const [list, setList] = useState(null); const [catalog, setCatalog] = useState(null);
  const [page, setPage] = useState(1); const [search, setSearch] = useState(''); const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState(null); const [target, setTarget] = useState(null);
  const [error, setError] = useState(null); const [busy, setBusy] = useState(null); const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    request('/gym/catalog', { signal: controller.signal }).then(setCatalog).catch(failure => { if (!controller.signal.aborted) setError(failure); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    const timer = setTimeout(() => request(`/workouts?${new URLSearchParams({ page, q: search })}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setList(result); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); }), 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [revision, page, search]);
  async function edit(id) {
    setBusy(id); setError(null);
    try { const routine = await request(`/workouts/${id}`); setEditor(routine); }
    catch (failure) { setError(failure); }
    finally { setBusy(null); }
  }
  async function duplicate(routine) {
    setBusy(routine.id); setError(null);
    try {
      const latest = await request(`/workouts/${routine.id}`);
      await request('/workouts', { method: 'POST', body: { ...latest, name: `${latest.name.slice(0, 100)} ${t('workouts.copySuffix')}` } });
      setPage(1); setSearch(''); setRevision(value => value + 1);
    } catch (failure) { setError(failure); }
    finally { setBusy(null); }
  }
  async function remove() {
    setBusy(target.id); setError(null);
    try { await request(`/workouts/${target.id}`, { method: 'DELETE', body: { version: target.version } }); setTarget(null); setPage(1); setRevision(value => value + 1); }
    catch (failure) { setError(failure); }
    finally { setBusy(null); }
  }
  if (editor) return <WorkoutEditor key={editor.id || 'new'} initial={editor.id ? editor : null} catalog={catalog} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setPage(1); setSearch(''); setRevision(value => value + 1); }} />;
  const number = value => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  return <section className="workouts-page">
    <div className="workouts-toolbar"><label className="workout-search"><Search size={17} /><input aria-label={t('workouts.searchRoutines')} placeholder={t('workouts.searchRoutines')} maxLength={100} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
      <button className="button primary" onClick={() => setEditor({})} disabled={!catalog?.available || Boolean(busy)}><Plus size={17} />{t('workouts.new')}</button></div>
    {error && <div className="error-banner" role="alert">{messageText(error)}<button onClick={() => setRevision(value => value + 1)}>{t('common.retry')}</button></div>}
    {catalog && !catalog.available && <p className="workout-warning">{t('workouts.noCatalog')}</p>}
    {loading ? <div className="workout-loading" role="status"><LoaderCircle className="spin" size={24} />{t('common.loading')}</div> : list?.items.length ? <>
      <p className="workout-list-count">{t('workouts.savedCount', { count: list.total })}</p>
      <div className="workout-grid">{list.items.map(routine => <article className="panel workout-card" key={routine.id}>
        <div className="workout-card-top"><span className="workout-card-icon"><Dumbbell size={19} /></span><span>{new Date(routine.updatedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</span></div>
        <h2><button onClick={() => edit(routine.id)} disabled={Boolean(busy)}>{routine.name}</button></h2>
        <div className="workout-card-content"><div><div className="workout-card-stats"><span><strong>{routine.load.exerciseCount}</strong>{t('workouts.exercises')}</span><span><strong>{routine.load.totalSets}</strong>{t('workouts.sets')}</span><span><strong>{routine.load.totalRepetitions}</strong>{t('workouts.reps')}</span></div>
          <div className="workout-card-volume"><strong>{number(routine.load.totalLoad)}</strong><span>kg·rep</span></div>
          <div className="workout-card-groups">{routine.load.groups.slice(0, 3).map(group => <span key={group.id}>{group.name}<strong>{number(group.percentage)}%</strong></span>)}</div>
          {!routine.load.totalLoad && <p className="workout-hint">{t('workouts.noLoad')}</p>}
          {routine.load.unknownLoad > 0 && <p className="workout-warning">{t('workouts.unmapped')}: {number(routine.load.unknownPercentage)}%</p>}
          {routine.load.missingLoadSets > 0 && <p className="workout-hint">{t('workouts.missingLoad', { count: routine.load.missingLoadSets })}</p>}
        </div><MuscleMap load={routine.load} compact /></div>
        <div className="workout-card-actions"><button className="button secondary" disabled={Boolean(busy)} onClick={() => edit(routine.id)}>{busy === routine.id ? <LoaderCircle size={15} className="spin" /> : <Pencil size={15} />}{t('workouts.open')}</button>
          <button className="icon-button" disabled={Boolean(busy)} aria-label={`${t('workouts.duplicate')}: ${routine.name}`} onClick={() => duplicate(routine)}><Copy size={17} /></button>
          <button className="icon-button" disabled={Boolean(busy)} aria-label={`${t('workouts.delete')}: ${routine.name}`} onClick={() => { setError(null); setTarget(routine); }}><Trash2 size={17} /></button></div>
      </article>)}</div>
      {list.total > list.pageSize && <div className="workout-pagination"><button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>{t('workouts.previous')}</button><span>{page} / {Math.ceil(list.total / list.pageSize)}</span><button className="button secondary" disabled={page * list.pageSize >= list.total} onClick={() => setPage(page + 1)}>{t('workouts.next')}</button></div>}
    </> : !error && <div className="panel workouts-empty"><Dumbbell size={40} strokeWidth={1.3} /><h2>{t(search ? 'workouts.noResults' : 'workouts.emptyTitle')}</h2><p>{t(search ? 'workouts.trySearch' : 'workouts.emptyHint')}</p>{!search && <button className="button primary" disabled={!catalog?.available} onClick={() => setEditor({})}><Plus size={16} />{t('workouts.new')}</button>}</div>}
    {target && <Modal title={t('workouts.deleteTitle')} subtitle={t('workouts.deleteHint', { name: target.name })} dismissible={!busy} onClose={() => setTarget(null)}>{error && <p className="form-error" role="alert">{messageText(error)}</p>}<div className="modal-actions"><button className="button secondary" disabled={Boolean(busy)} onClick={() => setTarget(null)}>{t('common.cancel')}</button><button className="button danger" disabled={Boolean(busy)} onClick={remove}>{t(busy ? 'common.deleting' : 'workouts.delete')}</button></div></Modal>}
  </section>;
}
