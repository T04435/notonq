import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { VersionBadge } from "@/components/version-badge";
import { versionText } from "@/lib/version";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "NotOnQ",
  description:
    "When the Qloo API has no data for an artist, NotOnQ returns the same shape from open sources, with a source on every value.",
  other: { "app-version": versionText() },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t">
          <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground">
            <p>Works with the Qloo API. Not affiliated with or endorsed by Qloo.</p>
            <div className="flex justify-center">
              <VersionBadge />
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
