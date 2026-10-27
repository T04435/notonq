import { DocsNav } from "@/components/docs-nav";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">NotOnQ docs</h1>
        <DocsNav />
      </div>
      <Alert>
        <AlertTitle>Artists only, for this hackathon</AlertTitle>
        <AlertDescription>
          NotOnQ fills in music artists (<code>urn:entity:artist</code>). Requests for any other entity type, and any request Qloo can answer, pass
          straight through to Qloo unchanged.
        </AlertDescription>
      </Alert>
      {children}
    </section>
  );
}
