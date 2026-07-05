# xtap-pool

Pool [xTap](https://github.com/osolmaz/xTap) captures with a group of friends.

xtap-pool is three pieces in one repo:

- **`extension/`** — a vendored fork of the xTap Chrome extension that keeps
  saving tweets locally exactly like xTap, and additionally syncs them to a
  shared, private Hugging Face Space.
- **`space/`** — the Hugging Face Docker Space that receives submissions,
  verifies who sent them, stamps attribution, deduplicates, and commits
  everything to a private HF dataset repo (the durable system of record).
- **`explorer/`** — a TypeScript + React + shadcn/ui web UI served by the
  Space for browsing, filtering, and searching the pooled tweets.

See [`docs/implementation-plan.md`](docs/implementation-plan.md) for the full
design and delivery plan.

## License

[MIT](LICENSE)
