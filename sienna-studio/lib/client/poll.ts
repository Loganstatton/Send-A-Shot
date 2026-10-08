import { api } from './api';

type Polled = { state: string };

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
  while (!isCancelled()) {
    await new Promise((r) => setTimeout(r, pollMs));
    const s = await api<S>(`${startUrl}?promptId=${encodeURIComponent(promptId)}`);
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
