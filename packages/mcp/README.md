# notonq (MCP)

The official Qloo MCP server ([`@qloo/qloo-harness`](https://www.npmjs.com/package/@qloo/qloo-harness), unchanged), with
[NotOnQ](https://github.com/T04435/notonq) behind it: when Qloo has no data for an artist, you get a Qloo-shaped answer
built from open sources, with a source on every value. Works with the Qloo API; not affiliated with or endorsed by Qloo.

```json
{
  "mcpServers": {
    "notonq": {
      "command": "npx",
      "args": ["-y", "notonq", "mcp"],
      "env": { "QLOO_API_KEY": "<your key>", "LASTFM_API_KEY": "<optional>", "NOTONQ_URL": "https://<notonq-host>" }
    }
  }
}
```

> **Scope: artists only.** NotOnQ fills music artists; everything else is the harness talking to Qloo as usual.

## What changes compared with `qloo mcp`

- **Same tools, same names, same envelope.** `qloo_describe`, `qloo_recommend`, `qloo_where_popular` and the rest come
  straight from the harness.
- **Gaps are filled, and labelled.** A result that contains NotOnQ data has `status: "partial"` and a warning; NotOnQ
  entity IDs start with `notonq:`.
- **Signals Qloo can't use still work.** If a name in `signals` is an artist Qloo has no taste data for, NotOnQ swaps in
  the Qloo IDs of similar artists Qloo does know, and the result says which.
- **Ambiguous names ask.** `qloo_describe` for a name that matches several small artists returns
  `status: "needs_input"` with `notonq_candidates`.

Three extra tools:

| Tool | Does |
|---|---|
| `notonq_candidates` | Every artist a name could be, across MusicBrainz, Last.fm and Deezer |
| `notonq_fill` | Fill from one candidate key: a Qloo-shaped entity with a `notonq:` ID |
| `notonq_provenance` | Source, record URL, licence and method for every value of a NotOnQ entity |

## Keys and data

Your Qloo key is forwarded per request and never stored. A loopback-only proxy adds your Last.fm key and an app label
(`NOTONQ_APP`) for NotOnQ's demand counts. Requires Node 22.19+.

MIT licence.
