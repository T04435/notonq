// The benchmark batch (scripts/benchmark.mts) is one more app calling NotOnQ: real Ask questions and /q calls under the
// app label "benchmark", counted on Proof like every other app's runs (Proof filters by app).
export const BENCHMARK_APP = "benchmark";

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
