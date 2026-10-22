'use strict';

const THEME_IDS = new Set(require('./themes.json').map((theme) => theme.id));
const LANGUAGE_IDS = new Set(require('../langs/languages.json').map((language) => language.code));

class InputError extends Error {
  constructor(message, statusCode = 400, code, messageKey) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || (statusCode === 404 ? 'SESSION_NOT_FOUND' : 'INVALID_INPUT');
    this.messageKey = messageKey;
  }
}

const SPORTS = new Set(['running', 'cycling', 'strength', 'walking', 'mobility', 'swimming']);
const PRIMARY_SPORTS = new Set(['running', 'cycling', 'swimming', 'gym', 'hiit']);

function validateProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Profilo non valido.', 400, undefined, 'errors.profileInvalid');
  for (const field of ['firstName', 'lastName']) {
    if (typeof input[field] !== 'string' || !input[field].trim() || input[field].trim().length > 80) {
      throw new InputError('Nome e cognome sono obbligatori, con un massimo di 80 caratteri ciascuno.', 400, undefined, 'errors.profileName');
    }
  }
  if (!PRIMARY_SPORTS.has(input.primarySport)) throw new InputError('Seleziona lo sport principale.', 400, undefined, 'errors.primarySport');
  if (input.theme !== undefined && !THEME_IDS.has(input.theme)) throw new InputError('Seleziona un tema disponibile.', 400, 'INVALID_THEME');
  if (input.language !== undefined && !LANGUAGE_IDS.has(input.language)) throw new InputError('Seleziona una lingua disponibile.', 400, 'INVALID_LANGUAGE');
  if (input.apiKey !== undefined && input.apiKey !== null &&
    (typeof input.apiKey !== 'string' || input.apiKey.trim().length > 8192 || /[\s\x00-\x1f\x7f]/.test(input.apiKey.trim()))) {
    throw new InputError('Inserisci una chiave Garmin valida, senza spazi o interruzioni di riga.', 400, undefined, 'errors.apiKey');
  }
  if (input.avatar !== undefined && input.avatar !== null &&
    (typeof input.avatar !== 'string' || input.avatar.length > 128 * 1024 || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.avatar))) {
    throw new InputError('Immagine del profilo non valida.', 400, 'INVALID_AVATAR');
  }
  return { firstName: input.firstName.trim(), lastName: input.lastName.trim(), primarySport: input.primarySport,
    ...(input.avatar === undefined ? {} : { avatar: input.avatar }),
    ...(input.theme === undefined ? {} : { theme: input.theme }),
    ...(input.language === undefined ? {} : { language: input.language }) };
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateSession(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Sessione non valida.', 400, undefined, 'errors.sessionInvalid');
  const { title, sport, date, time = '', durationMinutes, notes = '' } = input;
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 120) throw new InputError('Inserisci un titolo di massimo 120 caratteri.', 400, undefined, 'errors.sessionTitle');
  if (!SPORTS.has(sport)) throw new InputError('Seleziona uno sport valido.', 400, undefined, 'errors.sessionSport');
  if (!isCalendarDate(date)) throw new InputError('Inserisci una data valida.', 400, undefined, 'errors.sessionDate');
  if (typeof time !== 'string' || (time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new InputError('Inserisci un orario valido.', 400, undefined, 'errors.sessionTime');
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) throw new InputError('La durata deve essere tra 1 e 1440 minuti.', 400, undefined, 'errors.sessionDuration');
  if (typeof notes !== 'string' || notes.length > 2000) throw new InputError('Le note possono contenere fino a 2000 caratteri.', 400, undefined, 'errors.sessionNotes');
  return { title: title.trim(), sport, date, time, durationMinutes, notes: notes.trim() };
}

module.exports = { InputError, isCalendarDate, validateProfile, validateSession };
