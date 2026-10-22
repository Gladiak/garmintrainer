import { request as apiRequest } from './api.js';

// Run after a local dashboard load; a provider failure must not undo local saves.
export async function prepareProfileAccess({ profileId, status, signal, isCurrent, onChange, request = apiRequest }) {
  const current = () => !signal?.aborted && isCurrent();
  if (!profileId || !status?.configured || (status.valid && !status.refreshRequired) || !current()) return;
  onChange({ connecting: true, error: '' });
  try {
    const next = await request('/garmin/auth/ensure', { method: 'POST', profileId, signal });
    if (current()) onChange({ connecting: false, error: '', status: next });
  } catch (failure) {
    if (current()) onChange({ connecting: false, error: failure.name === 'AbortError' ? '' : failure.translationKey ? failure : failure.message });
  }
}
