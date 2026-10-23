import { useEffect, useId, useRef, useState } from 'react';
import { GripVertical, Maximize2, RotateCcw, Search, Trash2 } from 'lucide-react';
import defaults from '../../../../shared/dashboard-sections.json';
import { arrangeModules, changeModule, createModule, GRID_COLUMNS, MAX_GRID_ROWS, moduleGridStyle, readingOrder } from '../../../../shared/dashboard-grid.mjs';
import { useTranslation } from '../../hooks/useTranslation';
import { componentLibrary, componentName } from './ModuleLibrary';

export default function DashboardLayoutEditor({ sections, onChange, disabled, initialView = 'overview' }) {
  const { t, locale } = useTranslation();
  const [view, setView] = useState(initialView === 'wellness' ? 'wellness' : 'overview');
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const grid = useRef(null);
  const scroller = useRef(null);
  const gesture = useRef(null);
  const suppressClick = useRef(false);
  const animation = useRef(null);
  const editorId = useId();
  const modules = sections[view];
  const visible = preview?.modules || readingOrder(modules);
  const rows = Math.min(MAX_GRID_ROWS, Math.max(12, preview?.rows || 0, ...visible.map(item => item.y + item.h + 5)));
  const available = Object.entries(componentLibrary).filter(([type, definition]) => definition.sections.includes(view)
    && !modules.some(item => item.type === type)
    && componentName(type, t).toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)));

  function commit(next, message, focusId) {
    onChange({ ...sections, [view]: next });
    setAnnouncement(message);
    if (focusId) requestAnimationFrame(() => document.getElementById(`${editorId}-${focusId}`)?.focus({ preventScroll: true }));
  }

  function describe(item) {
    return t('layout.position', { name: componentName(item.type, t), column: item.x + 1, row: item.y + 1, width: item.w, height: item.h });
  }

  function add(type) {
    if (disabled || gesture.current || modules.some(item => item.type === type)) return;
    const item = createModule(modules, type, crypto.randomUUID());
    commit([...modules, item], t('layout.added', { name: componentName(type, t) }), item.id);
  }

  function remove(item) {
    commit(modules.filter(module => module.id !== item.id), t('layout.removed', { name: componentName(item.type, t) }));
    requestAnimationFrame(() => document.getElementById(`${editorId}-pool-${item.type}`)?.focus());
  }

  function finish(cancelled = false) {
    const action = gesture.current;
    if (!action) return;
    gesture.current = null;
    cancelAnimationFrame(animation.current);
    setPreview(null);
    if (action.active) {
      suppressClick.current = true;
      if (!cancelled && action.valid) {
        const item = action.next.find(module => module.id === action.item.id);
        commit(action.next, describe(item), action.mode === 'resize' ? `${item.id}-resize` : item.id);
      } else setAnnouncement(t('layout.cancelled'));
    }
    if (action.target.hasPointerCapture(action.pointerId)) action.target.releasePointerCapture(action.pointerId);
  }

  useEffect(() => {
    function cancel(event) {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      }
    }
    const blur = () => finish(true);
    const scroll = () => {
      const action = gesture.current;
      if (action?.active) updatePointer(action.clientX, action.clientY);
    };
    window.addEventListener('keydown', cancel, true);
    window.addEventListener('blur', blur);
    window.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('keydown', cancel, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('scroll', scroll, true);
      cancelAnimationFrame(animation.current);
    };
  }, []);

  // Intersect nested scroll/clipping containers so hidden edges never become
  // drop targets or prevent scrolling the surrounding settings panel.
  function visibleViewport(element) {
    const rect = element.getBoundingClientRect();
    const result = { left: Math.max(0, rect.left), right: Math.min(window.innerWidth, rect.right),
      top: Math.max(0, rect.top), bottom: Math.min(window.innerHeight, rect.bottom) };
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const styles = getComputedStyle(parent);
      const bounds = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(styles.overflowX)) {
        result.left = Math.max(result.left, bounds.left); result.right = Math.min(result.right, bounds.right);
      }
      if (/(auto|scroll|hidden|clip)/.test(styles.overflowY)) {
        result.top = Math.max(result.top, bounds.top); result.bottom = Math.min(result.bottom, bounds.bottom);
      }
      // A modal dialog lives in the top layer and escapes clipping by body
      // and the underlying dashboard, which may be shorter than the dialog.
      if (parent.matches('dialog[open]')) break;
    }
    const footer = scroller.current?.closest('form')?.querySelector('.modal-actions');
    if (footer) {
      const bounds = footer.getBoundingClientRect();
      if (bounds.right > result.left && bounds.left < result.right && bounds.bottom > result.top) {
        result.bottom = Math.min(result.bottom, bounds.top);
      }
    }
    return result;
  }

  function updatePointer(clientX, clientY) {
    const action = gesture.current;
    if (!action) return;
    action.clientX = clientX; action.clientY = clientY;
    if (!action.active && Math.hypot(clientX - action.startX, clientY - action.startY) < 5) return;
    action.active = true;
    const rect = grid.current.getBoundingClientRect();
    const viewport = visibleViewport(scroller.current);
    const styles = getComputedStyle(grid.current);
    const gap = parseFloat(styles.columnGap);
    const pitchX = (rect.width + gap) / GRID_COLUMNS;
    const pitchY = parseFloat(styles.gridAutoRows) + parseFloat(styles.rowGap);
    const tolerance = 16;
    action.valid = viewport.right > viewport.left && viewport.bottom > viewport.top
      && clientX >= viewport.left - tolerance && clientX <= viewport.right + tolerance
      && clientY >= viewport.top - tolerance && clientY <= viewport.bottom + tolerance;
    let next = action.snapshot;
    if (action.valid) {
      let change;
      if (action.mode === 'resize') {
        change = { w: action.item.w + Math.round((clientX - rect.left - action.startContentX) / pitchX),
          h: action.item.h + Math.round((clientY - rect.top - action.startContentY) / pitchY) };
      } else {
        change = { x: Math.round((clientX - rect.left - action.offsetX) / pitchX),
          y: Math.round((clientY - rect.top - action.offsetY) / pitchY) };
      }
      const base = action.mode === 'add' ? [...action.snapshot, action.item] : action.snapshot;
      next = changeModule(base, action.item.id, change);
    }
    action.next = next;
    action.rows = Math.min(MAX_GRID_ROWS, Math.max(action.rows, ...next.map(item => item.y + item.h + 5)));
    setPreview({ modules: next, id: action.item.id, valid: action.valid, type: action.item.type, clientX, clientY,
      mode: action.mode, rows: action.rows, left: clientX - action.offsetX, top: clientY - action.offsetY,
      width: action.item.w * pitchX - gap, height: action.item.h * pitchY - parseFloat(styles.rowGap) });
  }

  function autoScroll(timestamp) {
    const action = gesture.current;
    if (!action) return;
    const elapsed = Math.min(32, timestamp - (action.lastFrame ?? timestamp)) / 1000;
    action.lastFrame = timestamp;
    if (action.active) {
      const velocity = (pointer, min, max) => {
        const zone = Math.min(56, (max - min) / 3);
        if (zone <= 0 || pointer < min - 24 || pointer > max + 24) return 0;
        if (pointer < min + zone) return -480 * Math.min(1, (min + zone - pointer) / zone);
        if (pointer > max - zone) return 480 * Math.min(1, (pointer - max + zone) / zone);
        return 0;
      };
      // Inner canvas first; if its edge is clipped or exhausted, scroll its
      // ancestor instead. This also supports horizontal panning on mobile.
      let moved = false;
      const consumed = { x: false, y: false };
      for (let element = scroller.current; element && !element.matches('dialog'); element = element.parentElement) {
        const viewport = visibleViewport(element);
        if (action.clientX < viewport.left - 24 || action.clientX > viewport.right + 24
          || action.clientY < viewport.top - 24 || action.clientY > viewport.bottom + 24) continue;
        const rect = element.getBoundingClientRect();
        const styles = getComputedStyle(element);
        for (const [axis, property, overflow, min, max, pointer, edgeMin, edgeMax] of [
          ['x', 'scrollLeft', styles.overflowX, viewport.left, viewport.right, action.clientX, rect.left, rect.right],
          ['y', 'scrollTop', styles.overflowY, viewport.top, viewport.bottom, action.clientY, rect.top, rect.bottom],
        ]) {
          if (consumed[axis] || !/(auto|scroll)/.test(overflow)) continue;
          const speed = velocity(pointer, min, max);
          if (!speed || (element === scroller.current
            && ((speed < 0 && min > edgeMin + 2) || (speed > 0 && max < edgeMax - 2)))) continue;
          const before = element[property];
          element[property] += speed * elapsed;
          if (element[property] !== before) { consumed[axis] = true; moved = true; }
        }
      }
      if (moved) updatePointer(action.clientX, action.clientY);
    }
    animation.current = requestAnimationFrame(autoScroll);
  }

  function start(event, mode, item) {
    if (disabled || gesture.current || event.button !== 0 || !event.isPrimary) return;
    suppressClick.current = false;
    const rect = grid.current.getBoundingClientRect();
    const styles = getComputedStyle(grid.current);
    const gap = parseFloat(styles.columnGap);
    const pitchX = (rect.width + gap) / GRID_COLUMNS;
    const pitchY = parseFloat(styles.gridAutoRows) + parseFloat(styles.rowGap);
    const module = mode === 'add' ? createModule(modules, item, crypto.randomUUID()) : item;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { pointerId: event.pointerId, target: event.currentTarget, mode, item: module, snapshot: readingOrder(modules), next: modules,
      startX: event.clientX, startY: event.clientY, clientX: event.clientX, clientY: event.clientY,
      startContentX: event.clientX - rect.left, startContentY: event.clientY - rect.top,
      offsetX: mode === 'add' ? (pitchX - gap) / 2 : event.clientX - rect.left - module.x * pitchX,
      offsetY: mode === 'add' ? (pitchY - gap) / 2 : event.clientY - rect.top - module.y * pitchY,
      rows, valid: false, active: false };
    animation.current = requestAnimationFrame(autoScroll);
  }

  const pointerEvents = {
    onPointerMove: event => { if (gesture.current?.pointerId === event.pointerId) updatePointer(event.clientX, event.clientY); },
    onPointerUp: event => { if (gesture.current?.pointerId === event.pointerId) finish(); },
    onPointerCancel: () => finish(true),
    onLostPointerCapture: () => finish(true),
  };

  function keyboard(event, item, resize = false) {
    if (disabled || gesture.current) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); remove(item); return;
    }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const next = changeModule(modules, item.id, resize ? { w: item.w + delta[0], h: item.h + delta[1] } : { x: item.x + delta[0], y: item.y + delta[1] });
    commit(next, describe(next.find(module => module.id === item.id)));
  }

  return <div className="page-layout-editor">
    <div className="layout-editor-toolbar">
      <div className="layout-page-switch" role="group" aria-label={t('modules.layoutSection')}>
        {['overview', 'wellness'].map(page => <button key={page} type="button" className={page === view ? 'active' : ''} aria-pressed={page === view} disabled={disabled || Boolean(preview)} onClick={() => { setView(page); setSearch(''); }}>{t(`nav.${page}`)}</button>)}
      </div>
      <button type="button" className="button secondary layout-reset" disabled={disabled || Boolean(preview)} onClick={() => commit(arrangeModules(defaults[view].map(type => ({ id: crypto.randomUUID(), type }))), t('layout.restored'))}><RotateCcw size={14} />{t('layout.reset')}</button>
    </div>
    <p className="layout-editor-help" id={`${editorId}-help`}>{t('layout.help')}</p>
    <div className="layout-editor-workspace">
      <aside className="layout-component-pool" aria-label={t('layout.library')}>
        <h3>{t('layout.library')}</h3>
        <label className="layout-search"><Search size={15} aria-hidden="true" /><input type="search" value={search} disabled={disabled} onChange={event => setSearch(event.target.value)} placeholder={t('layout.search')} aria-label={t('layout.search')} /></label>
        <div className="layout-pool-items">
          {available.map(([type]) => <button key={type} id={`${editorId}-pool-${type}`} type="button" className="layout-pool-item" disabled={disabled} aria-label={t('layout.add', { name: componentName(type, t) })} aria-describedby={`${editorId}-help`}
            onPointerDown={event => start(event, 'add', type)} {...pointerEvents}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') suppressClick.current = false; }}
            onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } add(type); }}>
            <GripVertical size={16} aria-hidden="true" /><span>{componentName(type, t)}</span>
          </button>)}
          {!available.length && <p className="layout-pool-empty">{t(search ? 'layout.noResults' : 'layout.allAdded')}</p>}
        </div>
      </aside>
      <section className="layout-page-preview" aria-label={t('layout.canvas', { name: t(`nav.${view}`) })}>
        <div className="layout-canvas-heading"><strong>{t(`nav.${view}`)}</strong><span>{t('layout.columns')}</span></div>
        <div className="layout-canvas-scroll" ref={scroller}>
          <div className={`layout-canvas ${preview?.valid ? 'is-dragging' : ''}`} ref={grid} style={{ gridTemplateRows: `repeat(${rows}, var(--editor-row))` }}>
            {!visible.length && <p className="layout-canvas-empty">{t('layout.empty')}</p>}
            {visible.map(item => <div key={item.id} data-layout-module={item.type} className={`layout-block ${preview?.id === item.id && preview.valid ? `is-active ${preview.mode === 'resize' ? 'is-resizing' : 'is-placeholder'}` : ''}`} style={moduleGridStyle(item)}>
              <button type="button" id={`${editorId}-${item.id}`} className="layout-block-drag" disabled={disabled} aria-label={t('layout.move', { name: componentName(item.type, t) })} aria-describedby={`${editorId}-help`}
                onPointerDown={event => start(event, 'move', item)} onKeyDown={event => keyboard(event, item)} {...pointerEvents}><span>{componentName(item.type, t)}</span></button>
              <button type="button" className="layout-block-remove" disabled={disabled || Boolean(preview)} onClick={() => remove(item)} title={t('layout.remove', { name: componentName(item.type, t) })} aria-label={t('layout.remove', { name: componentName(item.type, t) })}><Trash2 size={15} /></button>
              <button type="button" id={`${editorId}-${item.id}-resize`} className="layout-block-resize" disabled={disabled} title={t('layout.resize', { name: componentName(item.type, t) })} aria-label={t('layout.resize', { name: componentName(item.type, t) })} aria-describedby={`${editorId}-help`}
                onPointerDown={event => start(event, 'resize', item)} onKeyDown={event => keyboard(event, item, true)} {...pointerEvents}><Maximize2 size={14} /></button>
            </div>)}
          </div>
        </div>
      </section>
    </div>
    {preview && preview.mode !== 'resize' && <div className={`layout-drag-ghost ${preview.valid ? 'is-valid' : ''}`} aria-hidden="true"
      style={{ left: preview.left, top: preview.top, width: preview.width, height: preview.height }}><GripVertical size={16} /><span>{componentName(preview.type, t)}</span></div>}
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </div>;
}
