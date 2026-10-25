import { api } from './api';

type Polled = { state: string };

/** Polls in a row that may fail before the job is reported as failed. */
const MAX_POLL_MISSES = 3;

/**
 * Start a GPU job (POST startUrl) and poll GET `${startUrl}?promptId=` until it is done or
 * failed, reporting each status. Used by outfit analysis and the pose check.
 */
export async function runJob<S extends Polled>(
  startUrl: string,
  body: unknown,
  onStatus: (s: S) => void,
  isCancelled: () => boolean,
  { pollMs = 2000, timeoutMs = 10 * 60 * 1000 } = {},
): Promise<S | null> {
  const { promptId } = await api<{ promptId: string }>(startUrl, { method: 'POST', json: body });
  const started = Date.now();
  let misses = 0;
  while (!isCancelled()) {
    await new Promise((r) => setTimeout(r, pollMs));
    let s: S;
    try {
      s = await api<S>(`${startUrl}?promptId=${encodeURIComponent(promptId)}`);
      misses = 0;
    } catch (e) {
      // a dropped connection (phone switching networks, a server restart) shouldn't abandon a running job
      if (++misses >= MAX_POLL_MISSES || Date.now() - started > timeoutMs) throw e;
      continue;
    }
    if (isCancelled()) return null;
    onStatus(s);
    if (s.state === 'done' || s.state === 'error') return s;
    if (Date.now() - started > timeoutMs) {
      const t = { state: 'error', error: 'Timed out. Is the GPU server running?' } as unknown as S;
      onStatus(t);
      return t;
    }
  }
  return null;
}
