# Build brief: "Passive Fund Exposure" MVP (GitHub Pages + Actions)

## 0. What we're building and the one rule that governs everything

A static website that helps retirement savers understand when **index-rule changes** (e.g. the Nasdaq-100 "fast entry" rule effective May 1, 2026) may change what their passive funds hold — focused on fast-entry / low-float mega-IPOs (SpaceX, Anthropic, OpenAI). It is an **education and analytics product, NOT investment advice.**

**The governing rule — enforce it in every line of copy and every code path:**
The product is *descriptive, never prescriptive*. It may state facts ("this fund tracks this index," "the index changed this rule," "this company may qualify for inclusion," "this may change your exposure," "here are the tradeoffs," "here are questions to ask a plan administrator or adviser"). It must **never** say buy, sell, "you should," "this is safe," "this will lose money," "guaranteed," or characterize anyone's fiduciary conduct. Add an automated copy-lint (see §7) that fails the build if banned phrases appear in user-facing text.

I am not a lawyer; a securities attorney must review copy before any paid/personalized tier ships. Keep payments and personalization OUT of Phase 1.

## 1. Architecture (and why)

- **GitHub Pages** serves the static site. No backend, no DB, no secrets in the served site.
- **All user exposure analysis runs client-side in the browser.** The user's fund list / uploaded statement is parsed and analyzed entirely in JS. It is never transmitted anywhere. Surface this prominently as a privacy guarantee.
- **GitHub Actions** provide the "backend": scheduled jobs fetch source data, regenerate `/data/*.json`, and commit. Pages redeploys automatically.
- **External services** for the things Pages can't do: a newsletter provider (Buttondown or ConvertKit — ASK ME which) holds the email list and sends broadcasts; an optional hosted checkout link (Stripe Payment Link or Gumroad) for a manually-fulfilled concierge report. Do not build a payment backend.

## 2. Repository structure

```
/                      # static site root (served by Pages)
  index.html           # landing: one-line promise + email capture + privacy guarantee
  /explainer/          # flagship plain-language piece (SpaceX/Nasdaq fast entry)
  /analyzer/           # client-side Exposure Analyzer
  /tracker/            # Methodology & Event tracker (renders from data JSON)
  /about/, /privacy/, /disclaimer/
  feed.xml             # RSS of events (generated)
/data/
  funds.json           # curated fund universe + index mapping + concentration (SOURCED)
  events.json          # IPO/index events timeline
  methodology.json     # index methodology changes log
/scripts/
  refresh_data.(py|js) # fetches sources, updates /data, run by Action
  copy_lint.(py|js)    # fails build on banned advice phrases
/.github/workflows/
  build-deploy.yml
  refresh-data.yml
  broadcast-alert.yml  # scaffold, can stay disabled in Phase 1
```

Use a simple static stack — plain HTML/CSS/vanilla JS, or a light generator (Eleventy or Astro). Bias to the simplest thing that builds cleanly on Actions. Mobile-first and accessible (semantic HTML, keyboard nav, sufficient contrast).

## 3. PHASE 1 — build now

### 3a. Landing page
- One promise: "We tell you when index-rule changes change what your retirement funds own."
- Email capture via the newsletter provider's embed/form (list lives with the provider, NOT in this repo).
- Privacy guarantee line: holdings are analyzed in your browser and never sent to a server.
- Persistent disclaimer component (educational, not advice).

### 3b. Flagship explainer (`/explainer/`)
Content from a markdown file. Plain-language walkthrough of: what "passive" really means (a fund follows a rulebook); the Nasdaq-100 fast-entry rule (top-40 by market cap, assessed ~7th trading day, added ~15 trading days, $5M ADTV liquidity test, low-float names enter at a capped weight ~33⅓% of float / ~3x float cap and ramp in tranches); the SpaceX case (targeting a June 12 Nasdaq listing, ticker SPCX); the contrast that S&P Dow Jones is NOT fast-tracking these (12-month seasoning + profitability), so timing differs by index. Keep numbers sourced and date-stamped.

### 3c. Exposure Analyzer (`/analyzer/`) — the core
Client-side only. Flow:
1. User selects funds from the curated universe OR types tickers OR pastes/uploads a 401(k) fund-menu list (parse text/CSV in-browser; PDF parsing optional/Phase 2).
2. For each recognized fund, look it up in `funds.json` and render a card:
   - what it tracks (index + weighting method, one-line plain meaning)
   - current concentration snapshot (top-10 weight, mega-cap share) — from sourced data, with `as_of` date shown
   - fast-entry / low-float exposure flag (yes/no + why), using the rules below
   - what's on the horizon (relevant pending IPOs/events from `events.json`)
   - tradeoffs (e.g., a broader total-market fund dilutes this exposure AND dilutes high-growth exposure — a tradeoff, not an upgrade)
   - questions to ask (HR / plan administrator / adviser / fund provider)
3. Portfolio roll-up: aggregate mega-IPO/low-float exposure and duplicated exposure across funds.
4. Every output ends with the disclaimer. No buy/sell language anywhere.

**Exposure-flag rules (encode as logic, not prose):**
- Nasdaq-100 funds (QQQ, QQQM) → directly affected by fast entry.
- Large-cap growth (VUG, SCHG, IWF) & tech-sector (VGT, XLK, FTEC) → likely to pick up new mega-caps; flag as exposed.
- S&P 500 (VOO, IVV, SPY) & total-market (VTI, ITOT, SCHB) → flag as "different timing": S&P is not fast-tracking, so exposure arrives later/under different rules.
- Target-date funds → indirect: they hold underlying index funds; flag and explain the pass-through.
- International (VXUS, VEA), bond (BND), dividend (SCHD) → use as low/zero-exposure comparison anchors.

### 3d. Methodology & Event tracker (`/tracker/`)
Renders `methodology.json` (index rule changes) and `events.json` (IPO filings, eligibility windows, lockup expiries, reconstitution dates) as a timeline. Generate `feed.xml` (RSS) from events so power users can subscribe for free.

## 4. Data layer — DO NOT FABRICATE NUMBERS

Seed `funds.json` with this universe (ticker → index mapping is stable; **concentration numbers must be sourced from issuer holdings files / prospectuses, stamped with `as_of` and `source_url`, or set to null with a visible "unverified" TODO**):

VOO, IVV, SPY (S&P 500); VTI, ITOT, SCHB (total market); QQQ, QQQM (Nasdaq-100); VUG, SCHG, IWF (large-cap growth); VGT, XLK, FTEC (tech sector); VXUS, VEA (international); BND (bond); SCHD (dividend); plus common 401(k) target-date series (Vanguard Target Retirement, Fidelity Freedom, T. Rowe Price Retirement) as fund-of-funds entries.

```jsonc
// funds.json entry
{
  "ticker": "QQQ",
  "name": "Invesco QQQ Trust",
  "tracks_index": "Nasdaq-100",
  "weighting": "modified market-cap",
  "top10_weight_pct": null,        // SOURCE IT, don't invent
  "megacap_share_pct": null,       // SOURCE IT
  "fast_entry_exposed": true,
  "exposure_note": "Directly tracks the Nasdaq-100; subject to fast-entry inclusions.",
  "as_of": "YYYY-MM-DD",
  "source_url": "<issuer holdings page>"
}
```
`events.json`: `{id, date, type (ipo_filing|listing|eligibility_window|lockup_expiry|reconstitution|methodology_change), title, summary, affected_indexes[], source_url}`.
`methodology.json`: `{index, change_date, summary, mechanism, source_url}`.

Data sources to wire in `refresh_data`: index provider methodology pages/FAQs (Nasdaq, S&P DJI, MSCI, FTSE Russell, CRSP); SEC EDGAR for S-1/424B/8-A large-IPO filings, float, lockups, dual-class; issuer daily holdings files for fund data. All public, no Plaid.

## 5. GitHub Actions
- **build-deploy.yml** — run copy-lint, build, deploy to Pages on push to main.
- **refresh-data.yml** — cron (start daily). Runs `refresh_data`, checks methodology pages + EDGAR for new events, updates `/data/*.json` + `feed.xml`, commits if changed. Only repo secrets if a source needs a key; never store PII.
- **broadcast-alert.yml** — scaffold now, can stay disabled. On manual dispatch (or when a material event lands), calls the newsletter provider API (key in repo secret) to send a broadcast. The email list stays with the provider.

## 6. Notifications design (my recommendation)
Phase 1: email capture embed (list at provider) + free RSS feed. Fast-follow: manual broadcast Action. Avoid: storing emails in the repo (PII leak in a public repo), browser push (overkill), self-hosted SMTP.

## 7. Compliance guardrails to implement
- Reusable disclaimer component on every page and at the end of analyzer output.
- `copy_lint` script run in build-deploy: fail on banned tokens in user-facing strings — buy, sell, "you should", "will lose", guaranteed, "safe", "fiduciary breach/violation", and similar. Maintain the banned list in one file.
- Privacy page stating holdings are processed in-browser and never transmitted.
- No personalization that implies suitability; no dollar-precise "what to do."

## 8. Phase 2 backlog — DO NOT build yet
Paid concierge report fulfilled manually behind a Stripe Payment Link / Gumroad link; PDF statement parsing; Plaid account linking; automated broadcasts; expanded fund universe; B2B/white-label view for advisers.

## 9. Definition of done (Phase 1)
Site builds and deploys to Pages via Actions; landing + explainer + analyzer + tracker live; analyzer runs fully client-side on the seeded universe and never makes a network call with user data; `/data/*.json` + RSS generated and refreshable by the scheduled Action; copy-lint passes; disclaimer + privacy pages present.

## 10. Confirm with me before assuming
1. Email provider: Buttondown or ConvertKit?
2. Repo name / custom domain?
3. Static stack preference (vanilla vs Eleventy vs Astro) — else pick the simplest.
4. Confirm the seed fund list above, and remember: source all concentration numbers; do not invent them.

Start by scaffolding the repo, the three core pages (landing, explainer, analyzer), the seeded `funds.json` with sourced/TODO'd data, and build-deploy + refresh-data workflows. Show me the structure before filling in all content.
