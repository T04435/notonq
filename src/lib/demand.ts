const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Asked once by 1 caller across 1 app" / "Asked 14 times by 3 callers across 2 apps". */
export const demandText = (d: { requests: number; callers: number; apps: number }) =>
  `Asked ${d.requests === 1 ? "once" : `${d.requests} times`} by ${plural(d.callers, "caller")} across ${plural(d.apps, "app")}`;
