import { useTranslation } from '../hooks/useTranslation';
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, subtitle, children, onClose, className = '', focusKey }) {
  const { t } = useTranslation();
  const dialog = useRef(null);
  const titleId = useId();
  const subtitleId = useId();
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    element.querySelector('input, select, textarea')?.focus();
    return () => element.close();
  }, []);
  useEffect(() => {
    if (focusKey !== undefined) {
      const element = dialog.current;
      element.querySelector('.modal-body').scrollTop = 0;
      (element.querySelector('[data-autofocus]') || element.querySelector('input:not([type="file"]), select, textarea') || element.querySelector('.modal-actions button'))?.focus();
    }
  }, [focusKey]);
  return (
    <dialog ref={dialog} className={`modal ${className}`} aria-labelledby={titleId} aria-describedby={subtitle ? subtitleId : undefined} onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label={t('common.closeWindow')} onClick={onClose}><X size={20} /></button>
      </div>
      <div className="modal-body">{subtitle && <p className="modal-subtitle" id={subtitleId}>{subtitle}</p>}{children}</div>
    </dialog>
  );
}
