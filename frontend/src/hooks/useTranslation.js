import { useSyncExternalStore } from 'react';
import { getLanguage, i18n, languageLocale, t } from '../lib/i18n';

export function useTranslation() {
  const language = useSyncExternalStore(i18n.subscribe, getLanguage, () => 'en');
  return { t, language, locale: languageLocale(language) };
}
