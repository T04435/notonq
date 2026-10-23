import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { Logo } from "@/components/brand/mark";
import { SiteNav } from "@/components/brand/site-nav";
import { VersionBadge } from "@/components/version-badge";
import { versionText } from "@/lib/version";
import "./globals.css";

// The Schema brand is set in JetBrains Mono throughout.
const mono = JetBrains_Mono({ variable: "--font-sans", subsets: ["latin"], weight: ["300", "400", "500", "700", "800"] });

export const metadata: Metadata = {
  title: "NotOnQ",
  description:
    "When the Qloo API has no data for an artist, NotOnQ returns the same shape from open sources, with a source on every value.",
  other: { "app-version": versionText() },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b">
          <nav className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <Link href="/" aria-label="NotOnQ home">
              <Logo />
            </Link>
            <SiteNav />
          </nav>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t">
          <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground">
            <p>Works with the Qloo API. Not affiliated with or endorsed by Qloo.</p>
            <p>
              Facts from MusicBrainz (CC0), Wikidata (CC0) and Wikipedia (CC BY-SA 4.0). Similar artists and listener counts from{" "}
              <a className="underline" href="https://www.last.fm">
                Last.fm
              </a>
              , powered by AudioScrobbler.
            </p>
            <div className="flex justify-center">
              <VersionBadge />
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
