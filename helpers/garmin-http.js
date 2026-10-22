'use strict';

let active = 0;
const queue = [];

// Bound provider traffic across all profiles in this application process.
async function withGarminRequest(run, signal) {
  signal?.throwIfAborted();
  if (active >= 2) await new Promise((resolve, reject) => {
    const entry = { resolve, reject, signal };
    entry.abort = () => {
      const index = queue.indexOf(entry);
      if (index >= 0) queue.splice(index, 1);
      reject(signal.reason);
    };
    signal?.addEventListener('abort', entry.abort, { once: true });
    queue.push(entry);
  });
  else active++;
  try { signal?.throwIfAborted(); return await run(); }
  finally {
    const next = queue.shift();
    if (next) {
      next.signal?.removeEventListener('abort', next.abort);
      next.resolve();
    } else active--;
  }
}

// Node 22+ supplies the original number token before it loses integer precision.
function parseGarminJson(body) {
  return JSON.parse(body, (key, value, context) => {
    if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
      if (!context?.source || !/^-?\d+$/.test(context.source)) throw new Error('Unsafe Garmin integer');
      return context.source;
    }
    return value;
  });
}

module.exports = { withGarminRequest, parseGarminJson };
