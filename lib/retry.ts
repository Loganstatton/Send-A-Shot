// A single automatic retry for a transient external-API failure — used by
// the Soundcharts and Deezer sync routes (see app/api/soundcharts/sync and
// app/api/deezer/sync). Deliberately NOT used for YouTube lookups: a retry
// there doubles the quota cost of every failure, which fights against the
// "YouTube quota protection" section of this same phase rather than helping
// reliability — a YouTube failure is left to the next scheduled sync run
// instead.
export async function withRetry<T extends { ok: boolean }>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let result = await fn();
  for (let i = 1; i < attempts && !result.ok; i++) result = await fn();
  return result;
}
