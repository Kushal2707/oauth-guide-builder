# OAuth Path

Look up an app, get a guide you can follow and share, know what to do next.
Five researched guides ship in the library (GitHub, Slack, Google, LinkedIn, Notion), and any other app can be researched live by an agent pipeline and saved as a shareable guide.

## Run it

```bash
npm test                        # 17 checks, no network or key needed
npm start                       # http://localhost:3000, library only
ANTHROPIC_API_KEY=sk-... npm start   # also enables live generation
npm run build:static            # dist/oauth-guides-demo.html, one offline file
```

Node 18+, zero dependencies. `ANTHROPIC_MODEL` overrides the model; `GEN_PER_HOUR` (default 5) rate-limits generation per IP.

## What a developer sees

Every guide answers the four questions in the brief with the same layout:

| Question | Where it is answered |
|---|---|
| How hard is it? | Difficulty 1-5 (Instant, Easy, Moderate, Hard, Gated) with a one-line rationale and access tiers table |
| How long, how much effort? | Two separate numbers: hands-on setup time and approval wait, plus a confidence level for the timeline |
| What could affect setup? | Requirements, scope tiers, blockers with "why" and "do this" |
| What can an agent do vs me? | Per-step owner badge (agent / you / either) and a two-column split |

Each step and requirement links to evidence items. Every evidence item carries a level:

- **tested**: the pipeline actually performed it against the provider (none yet, see Limitations)
- **documented**: stated on the provider's own domain
- **reported**: third-party blog, vendor doc, or forum
- **unverified**: model knowledge with no retrieved source

Each guide also states what was tested, lists open uncertainties, and shows a last-verified date.

## Architecture

```
public/index.html      single-page UI (home, live progress, guide page). /g/<slug> is the share URL
server.js              static files, /api/guides, /api/guide/:slug, /api/generate (SSE)
lib/pipeline.js        staged research agents
lib/anthropic.js       Messages API client with server-side web_search + pause_turn handling
lib/schema.js          guide schema validation, normalisation, verifier downgrade
data/guides/*.json     hand-curated library
data/generated/*.json  live-generated guides (cache, doubles as the share store)
```

### Pipeline for an unknown app

1. **Resolve**: name or URL to provider, developer portal, docs entry points. Stops early with a clear message if the product has no third-party OAuth.
2. **Docs, Approval, Community** run in parallel with web search, each with a narrow brief: registration mechanics; review gates, scope tiers, official timelines, AI-specific data policy; real-world waits, rejection reasons, workarounds.
3. **Synthesize** merges the notes into the schema as JSON. A validator checks structure, evidence references and honesty rules; one automatic repair pass runs if it fails.
4. **Verify**: a separate agent that did not write the guide checks each evidence item against the raw notes. Unsupported or overconfident claims are downgraded one level, confidence is reduced, and omissions are added to "Still uncertain".

Design choices worth knowing:

- Evidence levels are assigned by source domain, not by the model's confidence. A timeline from a blog can never display as "documented".
- The validator rejects a guide that claims "tested" evidence while saying nothing was executed.
- Generation is cached by slug; asking for an app that already has a guide returns it instantly.
- Progress streams over SSE so the person sees the stages as they happen.

## Scaling to 100 apps

The library format is the generation format, so the same pipeline runs as a batch job over a list of 100 providers.

1. Batch-generate drafts overnight (about 4 searches per stage per app).
2. Human spot-check queue sorted by lowest timeline confidence and most downgraded claims first. Reviewers fix and promote drafts into `data/guides/`.
3. Scheduled re-verification: re-run the approval and community stages monthly, diff against the stored guide, flag changed timelines or policies, and show a stale badge when `lastVerified` is older than 90 days.
4. Add a "tested" lane: a browser agent registers a throwaway app on providers where signup is automatable, records screenshots and each blocked step, and upgrades those evidence items to `tested`.
5. Add per-provider telemetry from real submissions (how long approval took for our users) to replace third-party anecdotes.

## Limitations (read before trusting a guide)

- **Nothing was tested against a live provider.** No developer accounts were created and no OAuth apps were registered, so no evidence item is `tested`. The library guides were built from web research in a single session; steps that come from model knowledge are marked `unverified`.
- Approval timelines are the weakest data. Google publishes none in the sources found; LinkedIn's third-party estimates disagree; Slack's numbers come from a third-party article. These guides say so and use low or medium confidence.
- Library guides were not independently verified by the verifier agent; that step is part of live generation only.
- Live generation was not run end to end because no API key was available while building. The pipeline logic, repair path, verifier and NO_OAUTH path are covered by tests with a scripted model, and the HTTP layer is tested, but real search quality and JSON compliance on unknown apps are unproven.
- The `web_search_20250305` tool type and default model string should be checked against current API docs when you deploy.
- Providers change policies; check the last-verified date.
