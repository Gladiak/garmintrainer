import { translationError } from './i18n.js';

let csrfToken;
export function setCsrfToken(value) { csrfToken = value; }

export async function request(path, { signal, method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method, signal,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(!['GET', 'HEAD'].includes(method) && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw translationError('errors.network');
  }
  if (response.status === 204) return null;
  let data;
  try { data = await response.json(); } catch {
    throw translationError('errors.unexpectedResponse');
  }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) {
      setCsrfToken(null);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('garmintrainer:unauthorized'));
    }
    const error = translationError(data?.error?.messageKey || (data?.error?.code ? `errors.${data.error.code}` : 'errors.requestFailed'));
    error.code = data?.error?.code;
    error.status = response.status;
    throw error;
  }
  return data;
}
