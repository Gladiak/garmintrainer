import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDateRange } from '../lib/dates';
import { useTranslation } from '../hooks/useTranslation';

export default function PeriodNavigation({ from, to, min, max, onSelect, onPrevious, onNext, onReset,
  isCurrent, previousDisabled = false, nextDisabled = false, previousLabel, nextLabel, resetLabel }) {
  const { t } = useTranslation();
  const label = formatDateRange(from, to);
  function openPicker(event) {
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    try {
      if (event.currentTarget.showPicker) { event.currentTarget.showPicker(); event.preventDefault(); }
    } catch { /* Keep the native date field usable if the browser does not allow opening its picker. */ }
  }
  return <div className="period-navigation" role="group" aria-label={t('date.navigation')}>
    <div className="period-navigation-controls">
      <button type="button" className="icon-button" aria-label={previousLabel || t('sync.previousPeriod')} disabled={previousDisabled} onClick={onPrevious}><ChevronLeft size={16} /></button>
      {onSelect ? <label className="period-date" title={label}>
        <CalendarDays size={15} aria-hidden="true" /><span aria-hidden="true">{label}</span><ChevronDown size={13} aria-hidden="true" />
        <input type="date" aria-label={t(from === to ? 'modules.referenceDay' : 'modules.rangeEndDay')} value={to} min={min} max={max}
          onChange={event => event.target.value && onSelect(event.target.value)}
          onClick={openPicker} onKeyDown={openPicker} />
      </label> : <span className="period-date period-date-static"><CalendarDays size={15} aria-hidden="true" /><span>{label}</span></span>}
      <button type="button" className="icon-button" aria-label={nextLabel || t('sync.nextPeriod')} disabled={nextDisabled} onClick={onNext}><ChevronRight size={16} /></button>
    </div>
    {onReset && !isCurrent && <button type="button" className="today-button" onClick={onReset}>{resetLabel || t('plan.today')}</button>}
  </div>;
}
