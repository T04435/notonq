// The key an artist name is cached, counted and given a record page under (/ledger/<key>): lowercase, no accents or
// punctuation. Shared by the server and the pages that link to a record.
export const nameKey = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** An artist's record page. */
export const recordHref = (name: string) => `/ledger/${encodeURIComponent(nameKey(name))}`;
