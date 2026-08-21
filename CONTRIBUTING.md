# Contributing to DeepScrape

Thanks for being here. This project is small enough that your PR will actually be read by a human, quickly.

## Quick start

```bash
git clone https://github.com/stretchcloud/deepscrape.git && cd deepscrape
npm install
cp .env.example .env      # set OPENAI_API_KEY and API_KEY
npm run dev               # http://localhost:3000/health
```

## Before you open a PR

```bash
npm run lint              # eslint
npm test                  # jest
npm run build             # tsc must pass clean
npm run openapi:check     # regenerate the OpenAPI spec if you changed a route
```

If you touched an API route, `npm run openapi:check` will fail until you run `npm run openapi:generate` and commit the result. This is deliberate — the spec is part of the contract.

## Good first contributions

- **Extraction recipes** — a working example against a real site, in `examples/`. These are genuinely the most useful thing you can add, and the bar is low.
- **Integrations** — LangChain, LlamaIndex, n8n, Dify, CrewAI adapters.
- **Failing test cases** — found a site where extraction breaks? A reproducing test is more valuable than a bug report.
- **Docs** — if something confused you, it will confuse the next person. Fix it.

## Ground rules

- One logical change per PR. Small PRs get merged; large ones get stuck.
- Add a test for anything that changes behaviour.
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`) — they generate the changelog.
- Don't add a dependency without saying why in the PR description.

## Scope

DeepScrape respects `robots.txt` and does not solve CAPTCHAs. PRs that add CAPTCHA bypass, ignore robots directives by default, or exist to evade access controls will be declined regardless of quality. Fingerprint consistency for legitimate automation is in scope; defeating bot protection to access data you aren't permitted to access is not.

## Reporting security issues

Don't open a public issue. See [SECURITY.md](SECURITY.md).
