import { getLanguage, languageLocale } from './i18n.js';

// Round only for display: keep provider values unchanged for charts, totals and storage.
export function formatNumber(value, locale = languageLocale(getLanguage())) {
  return Number.isFinite(value) ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value) : '—';
}
