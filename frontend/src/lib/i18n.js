import languages from '../../../langs/languages.json' with { type: 'json' };
import en from '../../../langs/en.json' with { type: 'json' };
import it from '../../../langs/it.json' with { type: 'json' };
import fr from '../../../langs/fr.json' with { type: 'json' };
import es from '../../../langs/es.json' with { type: 'json' };
import de from '../../../langs/de.json' with { type: 'json' };

export const DEFAULT_LANGUAGE = 'en';
export const LANGUAGES = Object.freeze(languages);
const catalogs = { en, it, fr, es, de };
const normalize = (language) => typeof language === 'string' && Object.hasOwn(catalogs, language) ? language : DEFAULT_LANGUAGE;
export const languageLocale = (language) => LANGUAGES.find((item) => item.code === normalize(language)).locale;

export function translate(key, values = {}, language = DEFAULT_LANGUAGE) {
  if (typeof key !== 'string') return '';
  const selected = normalize(language);
  let lookup = key;
  if (typeof values.count === 'number') {
    const plural = `${key}.${new Intl.PluralRules(languageLocale(selected)).select(values.count)}`;
    if (Object.hasOwn(catalogs[selected], plural) || Object.hasOwn(en, plural)) lookup = plural;
  }
  const message = Object.hasOwn(catalogs[selected], lookup) ? catalogs[selected][lookup] : Object.hasOwn(en, lookup) ? en[lookup] : key;
  return message.replace(/\{(\w+)\}/g, (placeholder, name) => Object.hasOwn(values, name) ? String(values[name]) : placeholder);
}

// One observable store serves React, date formatters and asynchronous API helpers.
// A form preview never overwrites the persisted profile language.
export function createI18n(initialLanguage = DEFAULT_LANGUAGE) {
  let saved = normalize(initialLanguage);
  let preview = null;
  let profileId = null;
  const listeners = new Set();
  const getLanguage = () => preview || saved;
  function change(update) {
    const previous = getLanguage();
    update();
    if (previous !== getLanguage()) for (const listener of listeners) listener();
  }
  return {
    getLanguage,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    t: (key, values) => translate(key, values, getLanguage()),
    setLanguage: (language) => change(() => { saved = normalize(language); preview = null; }),
    setProfileLanguage: (language, id = null) => change(() => {
      if (profileId !== id) preview = null;
      profileId = id;
      saved = normalize(language);
    }),
    previewLanguage: (language) => change(() => { preview = normalize(language); }),
    clearPreview: () => change(() => { preview = null; }),
  };
}

export function cachedProfileLanguage() {
  try {
    const id = localStorage.getItem('garmintrainer.profileId');
    return normalize(id ? localStorage.getItem(`garmintrainer.profileLanguage:${id}`) : DEFAULT_LANGUAGE);
  } catch { return DEFAULT_LANGUAGE; }
}

export const i18n = createI18n(cachedProfileLanguage());
export const getLanguage = i18n.getLanguage;
export const setLanguage = i18n.setLanguage;
export const t = i18n.t;
export function setProfileLanguage(language, profileId) {
  i18n.setProfileLanguage(language, profileId);
  if (profileId) {
    try { localStorage.setItem(`garmintrainer.profileLanguage:${profileId}`, normalize(language)); } catch { /* Optional startup cache. */ }
  }
}

export function translationError(key) {
  const safeKey = Object.hasOwn(en, key) ? key : 'errors.requestFailed';
  const error = new Error(t(safeKey));
  error.translationKey = safeKey;
  return error;
}

// Resolve at render time so an already visible error or toast also changes language.
export function messageText(message) {
  if (!message) return '';
  if (message.translationKey || message.key) return t(message.translationKey || message.key, message.values);
  return typeof message === 'string' ? message : t('errors.requestFailed');
}

function updateDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = getLanguage();
  document.title = t('page.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('page.description'));
}
i18n.subscribe(updateDocument);
updateDocument();
