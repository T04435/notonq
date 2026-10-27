import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationSource,
  InlineCitationText,
} from "@/components/ai-elements/inline-citation";
import type { Provenance } from "@/server/provenance";

const isUrl = (s: string) => /^https?:\/\//.test(s);

/** A value with its proof: a hover card naming each source, its licence and how the value was made. */
export function CitedValue({ children, sources }: { children: React.ReactNode; sources?: Provenance[] }) {
  const linked = (sources ?? []).filter((s) => isUrl(s.record));
  if (!sources?.length) return <>{children}</>;
  return (
    <InlineCitation>
      {/* Amber: this value is NotOnQ's (Qloo's own values are never cited, so they stay in ink). */}
      <InlineCitationText className="text-fill">{children}</InlineCitationText>
      <InlineCitationCard>
        <InlineCitationCardTrigger sources={linked.map((s) => s.record)} />
        <InlineCitationCardBody>
          <div className="flex flex-col gap-3 p-4">
            {sources.map((s, i) => (
              <InlineCitationSource
                key={i}
                title={`${s.source} · ${s.method}`}
                url={isUrl(s.record) ? s.record : undefined}
                description={[s.licence, s.note].filter(Boolean).join(" · ")}
              />
            ))}
          </div>
        </InlineCitationCardBody>
      </InlineCitationCard>
    </InlineCitation>
  );
}
