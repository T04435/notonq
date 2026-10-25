// Tier 3: a research agent for artists the open sources barely know. It searches the web (AI Gateway's Parallel
// search tool) and returns claims only, each with a URL and an exact quote. It never sees API keys, and its output
// is untrusted until the verifier has re-fetched every page.
import { gateway } from "@ai-sdk/gateway";
import { generateText, isStepCount, type LanguageModel, Output } from "ai";
import { CLAIM_FIELDS, type ClaimField, ClaimSet, FIELD_HELP, type Claim } from "@/server/research/claims";

export const RESEARCH_MODEL = process.env.NOTONQ_RESEARCH_MODEL ?? "anthropic/claude-sonnet-5.5";

export type ResearchInput = {
  name: string;
  /** What tiers 1–2 already know, so the agent researches the right artist (links, country, listeners). */
  known: string[];
  /** Only these fields are missing; the agent researches nothing else. */
  missing: ClaimField[];
};

const instructions = `You research small and emerging music artists for a data service. Find facts on the public web and
report them as claims. Rules:
- Only claim what a page states. For each claim give the page URL and an exact quote of 3 to 40 words copied from that
  page, character for character. The quote must contain the value (for descriptions, the facts you summarise).
- Make sure it is the same artist as the known facts describe. If you are not sure, make no claim.
- Prefer the artist's official site, label, Bandcamp, festival and press pages, and reviews. Never use qloo.com,
  tastedive.com, youtube.com or spotify.com pages as sources.
- Never estimate numbers, popularity, audiences or demographics. Public facts about the artist's music only: no
  birthdays, addresses, family or other personal details.
- Fewer, solid claims beat many weak ones. Return an empty list if you find nothing reliable.`;

export async function research(input: ResearchInput, { model }: { model?: LanguageModel } = {}): Promise<Claim[]> {
  const fields = input.missing.filter((f) => (CLAIM_FIELDS as readonly string[]).includes(f));
  if (!fields.length) return [];
  const { output } = await generateText({
    model: model ?? gateway(RESEARCH_MODEL),
    instructions,
    prompt: [
      `Artist: ${input.name}`,
      `Known facts:\n${input.known.map((k) => `- ${k}`).join("\n") || "- none"}`,
      `Research only these fields:\n${fields.map((f) => `- ${f}: ${FIELD_HELP[f]}`).join("\n")}`,
    ].join("\n\n"),
    tools: {
      webSearch: gateway.tools.parallelSearch({
        mode: "agentic",
        maxResults: 8,
        sourcePolicy: { excludeDomains: ["qloo.com", "tastedive.com", "youtube.com", "spotify.com"] },
      }),
    },
    stopWhen: isStepCount(6),
    output: Output.object({ schema: ClaimSet }),
  });
  return output?.claims ?? [];
}
