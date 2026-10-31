/** One run per key at a time: callers that ask for a key already running share that run's result (or error), so N
 * identical requests at once make one era fill, not N competing for MusicBrainz's 1 request a second. Per instance:
 * Fluid Compute sends concurrent requests to the same instance, which is where the duplicates arrive. */
export function singleFlight<T>() {
  const running = new Map<string, Promise<T>>();
  return (key: string, run: () => Promise<T>): Promise<T> => {
    const existing = running.get(key);
    if (existing) return existing;
    const p = run().finally(() => running.delete(key));
    running.set(key, p);
    return p;
  };
}
