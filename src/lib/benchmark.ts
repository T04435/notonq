// The benchmark batch (scripts/benchmark.mts): real Ask runs and /q calls, labelled so Proof counts them apart from
// real traffic. Every number on Proof comes from these runs or from real traffic, all in the Ledger.

/** benchmark-fresh / benchmark-chart: the two coverage samples. benchmark-fill: the questions about artists we filled in. */
export const BENCHMARK_APPS = ["benchmark-fresh", "benchmark-chart", "benchmark-fill"] as const;
export type BenchmarkApp = (typeof BENCHMARK_APPS)[number];
export const isBenchmarkApp = (app?: string | null): app is BenchmarkApp => !!app && (BENCHMARK_APPS as readonly string[]).includes(app);

export const COVERAGE_QUESTION = (artist: string) => `Recommend artists similar to ${artist}`;

/** The fill questions, one per thing we fill in, keyed by what each shows. */
export const FILL_QUESTIONS = {
  who: (a: string) => `Who is ${a} and where are they from?`,
  genre: (a: string) => `What genre is ${a}?`,
  similar: (a: string) => `Recommend artists similar to ${a}`,
  map: (a: string) => `Where is ${a} most popular?`,
  ages: (a: string) => `What ages listen to ${a}?`,
} as const;
export type FillQuestion = keyof typeof FILL_QUESTIONS;
