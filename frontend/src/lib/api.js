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
    throw new Error('Il server non è raggiungibile. Controlla che Express sia avviato.');
  }
  if (response.status === 204) return null;
  let data;
  try { data = await response.json(); } catch {
    throw new Error('Il server ha restituito una risposta inattesa.');
  }
  if (!response.ok) {
    const error = new Error(data.error?.message || 'Non è stato possibile completare la richiesta.');
    error.code = data.error?.code;
    error.status = response.status;
    throw error;
  }
  return data;
}
