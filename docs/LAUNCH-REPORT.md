# NEXT + Scout — launch report

The deliverables from §26 of the overhaul directive, as of 12 November 2026.
The companion documents are [DEPLOYMENT.md](DEPLOYMENT.md) (infrastructure,
backups, rollback), [SECURITY.md](SECURITY.md) (security review) and
[LEGAL-REVIEW.md](LEGAL-REVIEW.md) (questions for counsel).

## 1. Where things stand

- **Ready for a closed beta**, once the founder signs in as admin (the
  `ADMIN_EMAILS` setting is in place) and adds a first set of emerging
  artists. Production currently has **0 artists**, so a new visitor sees an
  empty-state invitation rather than a market.
- **Everything buildable without an outside decision is built.** What
  remains needs one of four decisions:
  1. a licensed source of verified audience data;
  2. money (the optional $7/month plan, NEXT Pro);
  3. legal review;
  4. retiring the Vercel copy.

## 2. Feature audit

Legend: ✅ working before the overhaul (kept) · 🔧 existed but repaired ·
🆕 new · ⏸ deferred · ⛔ blocked on a decision.

| Area (directive §) | Status | Notes |
|---|---|---|
| Persistent database (§3) | 🔧 | Moved from a wiped-on-restart SQLite file to Render Postgres. All trading is atomic with row locks; idempotent; concurrency-tested. |
| Backups / restore / staging / docs (§3) | 🆕 | Daily snapshots plus on-demand ones, download and restore with an undo snapshot, separate staging schema, and deployment and rollback docs. |
| Scout Score (§4) | 🔧🆕 | Honest labels, written guidelines per category, public Scout reasoning, last-rated date, change history, and who changed each rating (internal). |
| Verified Momentum (§4) | ⛔ | Shown as "Not available yet" on every artist page. Needs a licensed data source. |
| NEXT Price + Scout-vs-market explanation (§4) | 🔧 | "Undervalued" and "overheated" are replaced by "Scouts rate higher" and "Market ahead of Scouts", and How it works explains the method. |
| Trading engine (§5) | ✅🔧 | Already present and kept: impact pricing, average-fill pricing, no self-profit, sell-all, rate limit and manipulation flags. Repaired: atomicity, idempotency, whole-cent rounding and refusal of removed artists. Phantom weekly/monthly losses are fixed. |
| First-time experience (§6) | 🆕 | Visitors can browse without an account, with a pitch and "how it works". There's an accessible onboarding dialog with genre picks, Discover opens on "For you", and empty states are honest. |
| Discovery around music (§7) | ✅🆕 | Previews were already there. New: genre pages, editorial collections, artist-to-artist navigation, "New on NEXT", and better search and sort labels. |
| Founding Believer / early proof (§8) | ✅🆕 | Public proof pages with share cards, a track record on profiles, and discovery reputation. |
| Artist milestones (§8) | ⛔ | Needs verified before-and-after audience data. |
| Weekly challenges (§9) | 🆕 / ⛔ | Five weekly challenges with streaks and a leaderboard, built from NEXT's own data. The "predict verified growth" breakout competition is ⛔ until verified data exists. |
| Private leagues (§10) | 🆕 | Invite links, standings since joining, owner controls and recent picks. |
| Leaderboards and reputation (§11) | 🔧🆕 | Top Traders, Talent Scouts (reputation), Top Discoverers, Challenges and genre boards. |
| Artist claiming and dashboard (§12) | ✅🆕 | Claims and profile editing were already there. New: corrections, rating review, opt-out, impersonation and claim-dispute reports, a staff queue, and 30-day profile analytics. |
| Scout tool (§13) | ✅🔧 | Guidelines, reasoning, an accessible form, collections, the request queue and the audit log. Scout accuracy tracking exists, but needs verified growth data to become meaningful. |
| Feed (§14) | ✅🆕 | Kept; added hide, "show less about" and Settings unmute. |
| Notifications (§15) | 🔧🆕 | **Settings never saved before**, which is now fixed. Added league, artist-update and weekly challenge notifications. The email digest stays opt-in. |
| Mobile and accessibility (§16) | 🔧 | axe WCAG 2.1 AA clean on 30 page loads; form labels, contrast, focus outlines and a skip link. |
| Viral sharing (§17) | 🆕 | Proof cards, league invites, genre and collection pages with preview metadata, and share tracking. |
| Monetization (§18) | ⏸ | Plan below; nothing built (needs approval). |
| Positioning (§19) | 🔧 | The new headline and supporting copy, with claims limited to shipped features. Competitors are covered in §7 below. |
| Account basics (§20) | ✅🔧 | Verification, reset and deletion were already there. Revocable sessions and "log out other devices" are new. |
| Legal and trust (§21) | 🔧 | Age 13+, a fixed revision date, an updated privacy page and the counsel question list. Professional review is ⛔. |
| Analytics (§22) | 🔧🆕 | Funnel, growth loops, actives, next-week return, signup sources and beta feedback. |
| Security (§24) | 🔧🆕 | Login limits, sessions, headers, CSRF check and audit log. See SECURITY.md. |

## 3. Testing report

All of the following ran and passed on the final code. Numbers are counts of
tests or checks that actually executed.

| Layer | Scope | Result |
|---|---|---|
| Unit and integration (Vitest, real Postgres, a separate schema per file) | 39 files: trading, concurrency, scoring, leagues, challenges, reputation, collections, artist requests, analytics, security, social, backups and more | **500 / 500 passed** |
| Browser end-to-end (Playwright, production build) | 11 suites in `e2e/` (`npm run test:e2e`) | **193 / 193 checks passed** |
| Accessibility (axe-core WCAG 2.1 A/AA) | 30 page loads: signed out, signed in, phone | **0 violations** |
| Security over real HTTP | Headers, enumeration, brute force, CSRF, sessions, authorization, XSS, SQL injection | **14 / 14** |
| Staging (Render + the real Postgres) | Deployed to staging with its key path checked before merging: #82, #83, #86–#95, including migrations 004–011. #84 (form labels) and #85 (metrics page) were merged after local checks only. | Passed |
| Production | Render auto-deploys `main`. The latest merge (#95) is live; `/api/health` returns 200, and spot checks confirm genre pages, security headers and the new Terms. | Passed |
| Dependencies | `npm audit`, including dev tools | **0 vulnerabilities** |

**Not verified:**
- Real email delivery: no email provider was configured in testing.
- Live third-party syncs: YouTube, Deezer, Soundcharts and Wikidata were not reachable from the test environment.
- Real phones, Safari and Firefox: only emulated phone sizes in Chromium were tested.
- Load and performance at scale.
- An independent penetration test.
- Restoring a backup on production: the restore is tested in the suites, not run on production.

## 4. Infrastructure report

See [DEPLOYMENT.md](DEPLOYMENT.md).

**Setup**
- Render web service (production from `main`, staging from the working branch).
- Render Postgres Basic-256mb with 1 GB storage, about $6.30/month. Production and staging use separate schemas.
- Schema changes are versioned migrations (001–011) applied automatically under a lock.
- Daily jobs run from GitHub Actions: discovery, syncs and a snapshot.
- Snapshots: the newest 14 are kept, and they can be downloaded and restored from `/admin/backups`.

**Operational to-dos**
1. Set Render's health check path to `/api/health` on both services. It's currently blank, so a broken deploy could be put live.
2. Point an uptime monitor at `/api/health`.
3. Download a snapshot weekly and keep it off Render.
4. Decide on the Starter plan ($7/month) to remove the 30–60 second first load after the site has been idle.

## 5. Business and monetization plan

**Principles from the directive:** the free game must stay complete, there's no pay-to-win, no real-money trading or paid-entry prizes, and no spending without approval.

| Option | What it is | Cost to build / run | Validate first by |
|---|---|---|---|
| **NEXT Pro** (~$7.99/mo, hypothesis) | Deeper analytics on your own picks (full track record history, reputation breakdown), custom alerts, advanced filters, extended history. Nothing that changes rankings. | A payment processor (fees per transaction), a subscription UI, billing and refund terms, and legal review of auto-renewal. | During the beta, ask in feedback which of these people would pay for. Look at retention of the most active 10%, and only build checkout if a meaningful share say yes. |
| **Artist tools** | Profile customisation, deeper audience reports and clearly labelled "Sponsored" release placement. Never editorial ratings. | A sponsorship labelling system and FTC-style disclosure review. | Count artist claims and dashboard use (now on /metrics) and interview claimed artists. |
| **Industry analytics** | Scout-powered research for labels and managers: watchlists, growth history, the talent pipeline. | A separate B2B product; it needs verified data and enough history to be credible. | Only after the Verified Momentum data source exists and Scout accuracy tracking has real results. |
| **Sponsorship / ads** | Clearly labelled, after there's an audience. | Low build cost; reputational risk. | Not before the beta has active weekly users. |

**Running costs today:** about $6.30/month (database), plus $7/month if the Starter plan is approved. A licensed data source is the largest unknown cost and needs quotes.

## 6. Product roadmap (next, in order)

| # | Item | User impact | Effort | Depends on |
|---|---|---|---|---|
| 1 | Add 15–30 genuinely emerging artists with Scout reasoning | Critical: the market is empty | Staff time | Admin sign-in |
| 2 | 100-user closed beta (targets: 50 back an artist, 20 return the next week); read `/admin/feedback` weekly | High | Low | 1 |
| 3 | Choose a licensed audience-data source → Verified Momentum, milestones, the "predict verified growth" breakout challenge, and Scout accuracy against real growth | Very high: the core differentiator | Medium–high | Licensing decision and cost |
| 4 | Configure email delivery (verification, reset, digest) | High | Low | An email provider key |
| 5 | Seasons (quarterly leaderboard resets with permanent season records) | Medium | Medium | Beta data |
| 6 | Performance: standings are recomputed in memory per request (fine at beta scale); cache or materialise them past a few thousand players | Medium (later) | Medium | Growth |
| 7 | Script-src Content-Security-Policy with nonces | Low–medium | Medium | — |
| 8 | NEXT Pro, only if the beta shows demand | Revenue | Medium–high | 2, legal, processor |

## 7. Positioning and competitors

**Headline:** "Discover tomorrow's biggest artists. Prove you found them first." The copy describes only what's built: Score is human opinion, Price is a virtual game, Verified Momentum is "not available yet".

| | What it is (public descriptions) | Overlap with NEXT | Where NEXT differs |
|---|---|---|---|
| **A&R** (Product Hunt listing; "Trade with Taste" not confirmed as the same app) | Search any artist, track growth metrics daily, and buy or sell "shares"; a leaderboard on taste and who discovered an artist first. | Very close on the core loop. | Permanent, dated, public proof per backing; reputation that rewards being *followed* and penalises misses rather than raw returns; Scout-curated emerging artists with published reasoning; private leagues and weekly challenges. The weak spot: A&R claims daily real metrics, while NEXT has none until a data source is licensed. |
| **FanLabel** | Fantasy record label: sign songs, earn points from plays, leaderboards, prizes. A separate SongPicks app has paid cash contests. Partly owned by major labels. | Fantasy-style competition and leaderboards. | NEXT is about *emerging artists* before they break, not hit songs; no paid entry or cash prizes; proof of being early is the product. |

Sources: [A&R on Product Hunt](https://www.producthunt.com/products/a-r),
[RouteNote on FanLabel](https://routenote.com/blog/this-app-is-fantasy-football-for-the-next-music-hits/),
[Music Business Worldwide on FanLabel](https://musicbusinessworldwide.com/want-to-play-pretend-at-being-a-record-company-boss-now-you-can-with-a-fully-licensed-catalog),
[FanLabel SongPicks launch](https://jaybirdcom.com/fanlabel-launches-fanlabel-songpicks-app-allowing-music-fans-to-test-their-knowledge-for-cash-prizes/).
Nothing was copied from either product.

## 8. Why people come back (§23)

| User | Why sign up | Good first session | Tomorrow | Next week | Working toward | Shares |
|---|---|---|---|---|---|---|
| Casual fan | A friend's proof link or league invite | Picks genres, hears previews, backs one artist and gets backer #N | Feed, notifications about artists they back or watch | League standings, last week's challenge result | A track record; "I was early" | Proof cards, league invite |
| Competitive player | The leaderboard | Backs several artists early | Price moves, challenge progress | Streaks, weekly board, league rank | Talent Scout rank, reputation, streak | Profile, standings |
| Artist | Finds their own profile | Claims it, fixes details, posts an update | Watchers and backers | 30-day analytics, replies to requests | Fans who found them early | Their NEXT page |
| Scout (staff) | Internal tool | Rates against guidelines, writes reasoning | Candidate queue, requests | Collections, accuracy | A track record of calls | Collections |

**Versus Spotify, YouTube or TikTok:** those help you find music. NEXT adds a dated, public record that you found it first, a reputation for taste, and a game with friends.

## 9. Launch-readiness checklist

**Done**
- [x] Persistent database, atomic trades, backups and restore, staging, rollback docs
- [x] Honest scoring copy; no fabricated data anywhere
- [x] Accessible (axe-clean), keyboard-usable, mobile layouts
- [x] Security hardening and review
- [x] Analytics and in-app feedback for the beta
- [x] Terms and Privacy updated; age 13+

**Before inviting real users**
- [ ] Founder signs in as admin and adds 15–30 emerging artists, each with Scout reasoning
- [ ] Set the Render health check path to `/api/health`; add an uptime monitor
- [ ] Configure email (`RESEND_API_KEY`, `EMAIL_FROM`) so verification and reset emails arrive
- [ ] Decide: retire the Vercel copy (recommended)
- [ ] Decide: Starter plan ($7/month) or accept slow first loads
- [ ] Legal review of the items in LEGAL-REVIEW.md, at least age, privacy and virtual credits
- [ ] Download a snapshot and keep it off Render
- [ ] Invite list for the 100-user beta and a weekly feedback review

## 10. Change log (pull requests)

| PR | Change |
|---|---|
| #78 | All data moved to Postgres; atomic, concurrency-safe trading; backups; staging |
| #79 | Visitors can browse signed out; shareable early-proof pages; honest Scout-vs-market wording |
| #80 | Next.js 16.4.6 + React 19 (critical advisories) |
| #81 | Public "How NEXT works" page |
| #82 | Private leagues; fixed phantom weekly and monthly losses |
| #83 | Genre onboarding, "For you", accessible onboarding dialog |
| #84 | Accessible names for every form field |
| #85 | Growth-loop metrics |
| #86 | Weekly challenges; player track record |
| #87 | Last npm advisory patched |
| #88 | Scout Score transparency: reasoning, last rated, history, guidelines |
| #89 | Discovery reputation; Talent Scouts and Challenges boards |
| #90 | Genre pages, editorial collections, artist navigation |
| #91 | Artist requests: corrections, rating review, opt-out, impersonation |
| #92 | Signup sources, activity pulse, beta feedback |
| #93 | Security hardening and audit log |
| #94 | League activity, new notifications, feed hide/mute; fixed notification settings never saving |
| #95 | Accessibility (axe-clean, keyboard) and legal groundwork |
| (this PR) | Browser suites committed to `e2e/`; this report |

## 11. Remaining risks

1. **Empty market.** No artists on production yet; the first impression depends on the first catalogue.
2. **No verified audience data.** The defining "discover before they succeed" story can only be proven on NEXT's own activity until a licensed source exists. Competitors advertise real metrics.
3. **Manual scoring doesn't scale.** Every artist needs a Scout's time; the catalogue size is limited by staff.
4. **Multi-account abuse** is limited (email normalisation, qualifying-backer rule, integrity flags) but not prevented; email verification isn't required to play.
5. **Hosting limits.** Free web plan cold starts; one 1 GB database; in-memory leaderboard computation will need work past a few thousand active players.
6. **Legal** questions unresolved (see LEGAL-REVIEW.md).
7. **Testing gaps** (see §3): real email, live syncs, real devices and browsers, load, penetration test.
8. **Monetization unvalidated.** Every revenue path is a hypothesis.

## 12. Walkthrough: a new player

1. A friend sends a **league invite** (`/next/leagues/join/CODE`), which previews as "Join Pickers on NEXT". The visitor sees the league name, owner and member count, and **Sign up free to join**.
2. They sign up and land back on the invite. They **join** and see the standings, ranked by return since joining, so they start level.
3. The **onboarding** dialog explains virtual credits (not money) and asks for **genres** (up to 6). It explains Score (a Scout's rating) and Price (what players pay), then the proof record.
4. **Discover** opens on **For you**, showing their genres, with collections from the Scouts and a weekly challenges card.
5. They open an artist and **play the preview** (Crate digger progress). They read **Why the Score is what it is**: three Scout-rated groups, strengths, the Scout's notes, the last-rated date, and *Verified Momentum: not available yet*.
6. They **back** the artist and get Founding Believer **backer #3**. That completes Early call and New sound, and the **proof page** has a share card.
7. They share the proof link. A friend who opens it sees the record without an account and can sign up, which `/metrics` attributes to "proof link".
8. Over the week: league **recent picks**, notifications when someone joins their league or an artist they back posts, the **Talent Scouts** board as others follow their picks, and a **streak** once 3 challenges are done.
9. Anytime: **Send feedback (beta)** in the footer.
