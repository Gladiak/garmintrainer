import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, LoaderCircle, Plus, Search, Trash2, X } from 'lucide-react';
import { request } from '../../lib/api';
import { messageText } from '../../lib/i18n';
import { useTranslation } from '../../hooks/useTranslation';
import { workoutLoad } from '../../../../shared/workout-load.mjs';
import MuscleMap from './MuscleMap';
import Modal from '../Modal';

const newSet = () => ({ repetitions: 10, loadKg: null, restSeconds: 90 });
const draftExercise = exercise => ({ ...exercise, key: crypto.randomUUID(), sets: exercise.sets?.map(set => ({ ...set })) || [newSet(), newSet(), newSet()] });

export default function WorkoutEditor({ initial, catalog, onClose, onSaved }) {
  const { t, locale } = useTranslation();
  const [name, setName] = useState(initial?.name || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [exercises, setExercises] = useState(() => (initial?.exercises || []).map(draftExercise));
  const [search, setSearch] = useState(''); const [equipment, setEquipment] = useState(''); const [group, setGroup] = useState('');
  const [page, setPage] = useState(1); const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false); const [searchError, setSearchError] = useState(null);
  const [saving, setSaving] = useState(false); const [error, setError] = useState(null); const [discard, setDiscard] = useState(false);
  const [picker, setPicker] = useState(!initial); const [added, setAdded] = useState('');
  const resultsViewport = useRef(null);
  const source = useRef(JSON.stringify({ name: initial?.name || '', notes: initial?.notes || '', exercises: (initial?.exercises || []).map(({ importId, exerciseId, sets }) => ({ importId, exerciseId, sets })) }));
  const body = useMemo(() => ({ name, notes, exercises: exercises.map(({ importId, exerciseId, sets }) => ({ importId, exerciseId, sets })), ...(initial ? { version: initial.version } : {}) }), [name, notes, exercises, initial]);
  const dirty = source.current !== JSON.stringify({ name, notes, exercises: body.exercises });
  const load = useMemo(() => workoutLoad(exercises), [exercises]);
  const number = value => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  useEffect(() => {
    const unload = event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } };
    const navigation = event => { if (saving || (dirty && !window.confirm(t('workouts.discardHint')))) event.preventDefault(); };
    window.addEventListener('beforeunload', unload); window.addEventListener('garmintrainer:before-navigation', navigation);
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('garmintrainer:before-navigation', navigation); };
  }, [dirty, saving, t]);
  useEffect(() => {
    if (!picker || !catalog?.available) return;
    const controller = new AbortController();
    setSearching(true); setSearchError(null);
    const timer = setTimeout(async () => {
      try {
        const query = new URLSearchParams({ q: search, equipment, group, page });
        const response = await request(`/gym/exercises?${query}`, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setResults(response);
          resultsViewport.current?.scrollTo({ top: 0, behavior: 'instant' });
        }
      } catch (failure) { if (!controller.signal.aborted) { setSearchError(failure); setResults(null); } }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, equipment, group, page, picker, catalog?.available]);
  function updateSet(entry, index, field, value) {
    setExercises(previous => previous.map(exercise => exercise.key === entry ? { ...exercise, sets: exercise.sets.map((set, i) => i === index ? { ...set, [field]: value === '' ? null : Number(value) } : set) } : exercise));
  }
  function move(index, direction) {
    setExercises(previous => { const next = [...previous]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; });
  }
  function close() { if (dirty) setDiscard(true); else onClose(); }
  async function save(event) {
    event.preventDefault(); setError(null); setSaving(true);
    try { const saved = await request(initial ? `/workouts/${initial.id}` : '/workouts', { method: initial ? 'PUT' : 'POST', body }); onSaved(saved); }
    catch (failure) { setError(failure); }
    finally { setSaving(false); }
  }
  return <form className="workout-editor" onSubmit={save}>
    <div className="workout-editor-toolbar"><button type="button" className="button secondary" onClick={close} disabled={saving}><ArrowLeft size={16} />{t('workouts.back')}</button>
      <span>{t(initial ? 'workouts.edit' : 'workouts.new')}</span><button className="button primary" disabled={saving || !exercises.length}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{t(saving ? 'common.saving' : 'workouts.save')}</button></div>
    {error && <div className="error-banner" role="alert">{messageText(error)}</div>}
    <fieldset disabled={saving} className="workout-editor-fields">
      <div className="workout-editor-main">
        <section className="panel workout-details"><label>{t('workouts.name')}<input autoFocus required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder={t('workouts.namePlaceholder')} /></label>
          <label>{t('workouts.notes')}<textarea maxLength={2000} rows={2} value={notes} onChange={event => setNotes(event.target.value)} placeholder={t('workouts.notesPlaceholder')} /></label>
        </section>
        <div className="workout-exercise-heading"><h2>{t('workouts.exercises')}</h2><button className="button secondary" type="button" onClick={() => setPicker(!picker)} aria-expanded={picker}><Plus size={16} />{t('workouts.addExercise')}</button></div>
        {picker && <section className="panel exercise-picker" aria-label={t('workouts.catalog')}>
          <div className="exercise-picker-title"><h3>{t('workouts.catalog')}</h3><button type="button" className="icon-button" aria-label={t('common.closeWindow')} onClick={() => setPicker(false)}><X size={17} /></button></div>
          {!catalog?.available ? <p className="workout-hint">{t('workouts.noCatalog')}</p> : <>
            <div className="exercise-search"><label className="workout-search"><Search size={16} /><input aria-label={t('workouts.searchExercises')} placeholder={t('workouts.searchExercises')} maxLength={100} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
              <select aria-label={t('workouts.filterGroup')} value={group} onChange={event => { setGroup(event.target.value); setPage(1); }}><option value="">{t('workouts.allGroups')}</option>{catalog.groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
              <select aria-label={t('workouts.filterEquipment')} value={equipment} onChange={event => { setEquipment(event.target.value); setPage(1); }}><option value="">{t('workouts.allEquipment')}</option>{catalog.equipment.map(item => <option key={item} value={item}>{item}</option>)}</select></div>
            <p className="workout-picker-status" role="status">{searching ? t('common.loading') : results ? t('workouts.results', { count: results.total }) : ''}{added && ` · ${added} ${t('workouts.added')}`}</p>
            {searchError && <p role="alert" className="form-error">{messageText(searchError)}</p>}
            <div className="exercise-results" ref={resultsViewport} aria-busy={searching}>{results?.items.map(item => <article key={`${item.importId}:${item.exerciseId}`}>
              <div><strong>{item.name}</strong><span>{item.equipment} · {item.groups.filter(g => g.role === 'target').map(g => g.name).join(', ') || t('workouts.unmapped')}</span></div>
              <button type="button" className="icon-button" aria-label={`${t('workouts.addExercise')}: ${item.name}`} disabled={searching || exercises.length >= 40 || load.totalSets > 297} onClick={() => { setExercises(previous => [...previous, draftExercise(item)]); setAdded(item.name); }}><Plus size={18} /></button>
            </article>)}</div>
            {!searching && results?.total === 0 && <p className="workout-hint">{t('workouts.noResults')}</p>}
            {results?.total > results?.pageSize && <div className="workout-pagination"><button className="button secondary" type="button" disabled={page === 1 || searching} onClick={() => setPage(page - 1)}>{t('workouts.previous')}</button><span>{page} / {Math.ceil(results.total / results.pageSize)}</span><button className="button secondary" type="button" disabled={page * results.pageSize >= results.total || searching} onClick={() => setPage(page + 1)}>{t('workouts.next')}</button></div>}
          </>}
        </section>}
        {!exercises.length && <div className="workout-empty-exercises"><Plus size={24} /><p>{t('workouts.addFirstExercise')}</p></div>}
        {exercises.map((exercise, index) => <section className="panel workout-exercise" key={exercise.key}>
          <header><span className="exercise-number">{index + 1}</span><div><h3>{exercise.name}</h3><p>{exercise.equipment} · {exercise.groups.map(g => g.name).join(', ') || t('workouts.unmapped')}</p></div>
            <div className="workout-exercise-actions"><button className="icon-button" type="button" disabled={index === 0} aria-label={t('workouts.moveUp')} onClick={() => move(index, -1)}><ArrowUp size={16} /></button><button className="icon-button" type="button" disabled={index === exercises.length - 1} aria-label={t('workouts.moveDown')} onClick={() => move(index, 1)}><ArrowDown size={16} /></button><button className="icon-button" type="button" aria-label={t('workouts.removeExercise')} onClick={() => setExercises(previous => previous.filter(item => item.key !== exercise.key))}><Trash2 size={16} /></button></div>
          </header>
          <div className="workout-sets"><div className="workout-set-labels"><span>{t('workouts.set')}</span><span>{t('workouts.reps')}</span><span>{t('workouts.kg')}</span><span>{t('workouts.rest')}</span><span /></div>
            {exercise.sets.map((set, i) => <div className="workout-set-row" key={i}><span>{i + 1}</span>
              <input aria-label={`${exercise.name} · ${t('workouts.set')} ${i + 1} · ${t('workouts.reps')}`} type="number" inputMode="numeric" required min="1" max="1000" step="1" value={set.repetitions ?? ''} onChange={event => updateSet(exercise.key, i, 'repetitions', event.target.value)} />
              <input aria-label={`${exercise.name} · ${t('workouts.set')} ${i + 1} · ${t('workouts.kg')}`} type="number" inputMode="decimal" min="0" max="10000" step="0.01" placeholder="—" value={set.loadKg ?? ''} onChange={event => updateSet(exercise.key, i, 'loadKg', event.target.value)} />
              <input aria-label={`${exercise.name} · ${t('workouts.set')} ${i + 1} · ${t('workouts.rest')}`} type="number" inputMode="numeric" required min="0" max="3600" step="1" value={set.restSeconds ?? ''} onChange={event => updateSet(exercise.key, i, 'restSeconds', event.target.value)} />
              <button type="button" className="icon-button" disabled={exercise.sets.length === 1} aria-label={t('workouts.removeSet')} onClick={() => setExercises(previous => previous.map(item => item.key === exercise.key ? { ...item, sets: item.sets.filter((_, j) => j !== i) } : item))}><X size={15} /></button></div>)}
          </div><button className="workout-add-set" type="button" disabled={exercise.sets.length >= 30 || load.totalSets >= 300} onClick={() => setExercises(previous => previous.map(item => item.key === exercise.key ? { ...item, sets: [...item.sets, { ...item.sets.at(-1) }] } : item))}><Plus size={14} />{t('workouts.addSet')}</button>
        </section>)}
        <p className="workout-hint">{t('workouts.weightHint')}</p>
      </div>
      <aside className="panel workout-preview"><div className="workout-preview-heading"><span className="workout-eyebrow">{t('workouts.livePreview')}</span><h2>{t('workouts.distribution')}</h2></div>
        <div className="workout-preview-stats"><div><strong>{number(load.totalLoad)}</strong><span>kg·rep</span></div><div><strong>{load.totalSets}</strong><span>{t('workouts.sets')}</span></div><div><strong>{load.totalRepetitions}</strong><span>{t('workouts.reps')}</span></div></div>
        <MuscleMap load={load} />
        {load.missingLoadSets > 0 && <p className="workout-warning">{t('workouts.missingLoad', { count: load.missingLoadSets })}</p>}
        <details className="workout-formula"><summary>{t('workouts.howCalculated')}</summary><p>{t('workouts.formula')}</p></details>
      </aside>
    </fieldset>
    {discard && <Modal title={t('workouts.discardTitle')} subtitle={t('workouts.discardHint')} onClose={() => setDiscard(false)}><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setDiscard(false)}>{t('common.cancel')}</button><button type="button" className="button danger" onClick={onClose}>{t('workouts.discard')}</button></div></Modal>}
  </form>;
}
