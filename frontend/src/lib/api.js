import { translationError } from './i18n.js';

export async function request(path, { signal, method = 'GET', body, profileId } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method, signal,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(profileId ? { 'X-Profile-Id': profileId } : {}),
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
    const error = translationError(data?.error?.messageKey || (data?.error?.code ? `errors.${data.error.code}` : 'errors.requestFailed'));
    error.code = data?.error?.code;
    error.status = response.status;
    throw error;
  }
  return data;
}
