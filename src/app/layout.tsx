import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/mark";
import { SiteNav, SiteNavLinks } from "@/components/brand/site-nav";
import { VersionBadge } from "@/components/version-badge";
import { versionText } from "@/lib/version";
import "./globals.css";

// The Console brand is set in JetBrains Mono throughout.
const mono = JetBrains_Mono({ variable: "--font-sans", subsets: ["latin"], weight: ["300", "400", "500", "700", "800"] });

export const metadata: Metadata = {
  title: "NotOnQ",
  description:
    "When the Qloo API has no data for an artist, NotOnQ returns the same shape from open sources, with a source on every value.",
  other: { "app-version": versionText() },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${mono.variable} dark h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b">
          <nav aria-label="Main" className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
            <Link href="/" aria-label="NotOnQ home">
              <Logo />
            </Link>
            <Suspense fallback={<SiteNavLinks />}>
              <SiteNav />
            </Suspense>
          </nav>
        </header>
        <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col px-4 pt-8 pb-16 sm:px-6 sm:pt-12">{children}</main>
        <footer className="border-t">
          <div className="mx-auto flex max-w-[1280px] flex-wrap items-end justify-between gap-4 px-4 py-6 text-[11px] leading-[1.7] text-muted-foreground sm:px-6">
            <div className="flex max-w-[80ch] flex-col gap-1">
              <p>Works with the Qloo API. Not affiliated with or endorsed by Qloo.</p>
              <p>
                Facts from MusicBrainz (CC0), Wikidata (CC0) and Wikipedia (CC BY-SA 4.0). Similar artists and listener counts from{" "}
                <a className="text-subtle underline" href="https://www.last.fm">
                  Last.fm
                </a>
                , powered by AudioScrobbler.
              </p>
            </div>
            <VersionBadge />
          </div>
        </footer>
      </body>
    </html>
  );
}
