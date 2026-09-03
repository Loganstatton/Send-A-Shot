# NEXT + Scout — Zero-Cost Pre-Beta Migration: Source Audit

Status: **audit complete, no code changed yet.** This is the required
step-1 deliverable before any implementation begins, per the migration
brief. Full raw findings (file:line citations) are in the research pass
this table is built from; this document is the actionable summary.

## 1. Two critical findings that change the plan's priority order

These aren't in the original 17-step brief but surfaced during the audit
and should be fixed **first**, before the Deezer/Soundcharts swap-out,
because they're active privacy/compliance gaps on the *current* production
code, not just future-beta hygiene:

1. **Internal Scout data currently leaks to any signed-in NEXT user's
   browser.** `getNextArtist()`/`getNextMarket()` (`lib/db.ts:1509-1580`)
   return the *entire* `artists` row — including `soundcharts_uuid`,
   `stage`, `scout_name`, `notes`, `high_rating_note`, `claimed_by_user_id`,
   and every `*_synced_at`/`*_no_match_at` timestamp — as a prop into
   client components (`ArtistCard`, `DiscoverGrid`, `FeaturedArtist`,
   `FeedCard` are all `"use client"`). Next.js serializes that entire
   object into the page's RSC payload, so it's sitting in the page source
   for anyone who opens dev tools, even though only a few fields are
   visually rendered. This is exactly the "serialized React data / hidden
   JSON" leak vector section 3 of the brief calls out.
2. **A public badge directly announces Soundcharts linkage.**
   `app/next/artists/[id]/page.tsx:243-250` renders a "Linked to a live
   data source" badge driven by `artist.soundcharts_uuid != null` — i.e.
   the public artist page currently tells visitors, in plain language,
   that this specific artist's stats come from a third-party data vendor.

Proposed fix (folded into task **#20 provenance schema** + **#23 gate
Soundcharts**, section 4 below): introduce a `getPublicArtist()` /
`toPublicArtistDTO()` projection that whitelists exactly the fields the
public UI is allowed to see, and make `ArtistCard`/`DiscoverGrid`/
`FeaturedArtist`/`FeedCard` consume that DTO instead of the raw `Artist`
row. Remove the Soundcharts-linkage badge entirely (replace with nothing,
or with a NEXT-first-party "data freshness" indicator if desired later).

## 2. Every Deezer usage found

| # | Location | What it does | Public or internal |
|---|---|---|---|
| 1 | `lib/deezer.ts` | Keyless client: `searchArtist()` → photo; `getTopTrack()` → top-song link + 30s preview mp3; `getTopSongForArtist()` combines both | — |
| 2 | `app/api/deezer/sync/route.ts` | Batch job writing `photo_url`/`top_song_url`/`song_preview_url` for artists missing Deezer data | Internal session **or** cron (`x-cron-secret`) |
| 3 | `components/DeezerSyncButton.tsx` | Manual trigger button, only rendered on internal dashboard (`app/page.tsx`) | Internal only |
| 4 | `.github/workflows/discovery-scan.yml` step "Sync Deezer top songs" | Daily 10:00 UTC cron hitting `/api/deezer/sync` | Internal/infra |
| 5 | `components/AudioPreview.tsx` | Plays `artist.song_preview_url` (Deezer mp3) through the shared `<audio>`/`NowPlayingProvider`/`MiniPlayer` | **Public** — used on `ArtistCard`, artist detail page, `FeedCard` |
| 6 | `photo_url` (Deezer may have written it) | Rendered as artist hero image | **Public** — `ArtistCard`, `FeaturedArtist`, `VideoBanner`, `FeedCard`, Founding Believer page |
| 7 | `SpotifyPreview.tsx`'s `top_song_url` prop | Passed `artist.top_song_url` (a `deezer.com` link) as a candidate Spotify URL; `parseSpotifyUrl` rejects non-Spotify URLs and returns `null`, so in practice **this prop is dead** — the component only ever renders from `artist.spotify_url` | Public but functionally inert for Deezer data specifically |

No Deezer branding/attribution exists anywhere in the public UI — the
source is invisible to end users, which is itself a reason it's easy to
swap out cleanly.

## 3. Every Soundcharts usage found

| # | Location | What it does | Public or internal |
|---|---|---|---|
| 1 | `lib/soundcharts.ts` | `searchArtists()`, `getArtistData()` (metadata + Spotify follower/growth audience endpoint), `topArtists()` (plan-restricted, unused/unwired), `getFollowerHistory()` | — |
| 2 | `app/api/soundcharts/search/route.ts` | GET, `getInternalUser()` required | Internal only |
| 3 | `app/api/soundcharts/artist/[uuid]/route.ts` | GET, `getInternalUser()` required | Internal only |
| 4 | `app/api/soundcharts/sync/route.ts` | Batch job, writes followers/growth/photo/platform links for linked artists | Internal session **or** cron |
| 5 | `app/api/soundcharts/backfill/route.ts` | Backfills `photo_url` for unlinked artists, paced 300ms | Internal session **or** cron |
| 6 | `components/SoundchartsSearch.tsx`, `SoundchartsPhotoBackfillButton.tsx` | Internal dashboard UI | Internal only |
| 7 | `lib/youtube-discovery.ts:99-122` `matchAndEnrichWithSoundcharts()` | Best-effort enrich of a YouTube-sourced discovery candidate | Internal candidate queue only |
| 8 | `followers_count`, `monthly_listeners`, `growth_velocity_pct`, `engagement_rate_pct` (once written) | Rendered in artist detail page's "Momentum" module and in `ArtistCard`/`FeaturedArtist` blurb text | **Public** |
| 9 | "Linked to a live data source" badge | Directly checks `soundcharts_uuid != null` | **Public** (see finding #2 above) |
| 10 | `growthVelocityScore()` (`lib/scoring.ts:43-46`) | `sqrt(clamp(growth_velocity_pct,0,50)/50)*10` — feeds the `growth_velocity` Breakout Score category (weight 15) | Feeds a Scout-internal score, not directly public, but that score contributes to a public-facing rank indirectly (see §6) |
| 11 | `soundcharts_uuid` and other internal columns | Leaked via full-row serialization (finding #1 above) | **Public** (unintentional) |

One useful nuance: `engagement_rate_pct` is **never actually written by
`getArtistData()`** in the current code (confirmed by reading
`soundcharts.ts:108-186` — the Spotify audience endpoint response is only
mapped to `followers_count`/`growth_velocity_pct`). So `engagement_quality`
Breakout Score category is already effectively Scout-manual-entry-only
today; there's no live automated source to migrate away from for that one
specific category, which simplifies task #29.

## 4. Every YouTube usage found

| # | Location | What it does | Compliant already? |
|---|---|---|---|
| 1 | `lib/youtube.ts` | Quota-tracked client; `getFeaturedVideoForArtist()` resolves + verifies embeddability via public oEmbed before saving | — |
| 2 | `lib/youtube-discovery.ts` | Orchestrates discovery scan across genre buckets | — |
| 3 | `lib/youtube-momentum.ts` | Pure scoring functions, `momentum_score` formula (weighted views/sub, views/day, hype-comment-rate, like-rate, comment-rate) | Internal-only, never becomes NEXT/Breakout score |
| 4 | `app/api/discovery/scan-youtube/route.ts`, `app/api/youtube/sync-videos/route.ts` | Batch jobs | Internal session or cron |
| 5 | `components/YoutubeScanButton.tsx`, `YoutubeVideoSyncButton.tsx` | Internal dashboard triggers | Internal only |
| 6 | `components/next/VideoBanner.tsx` | **Public** artist-detail hero. Shows a static `img.youtube.com/vi/{id}/hqdefault.jpg` thumbnail with a play button; only swaps in a `youtube-nocookie.com/embed` iframe **after an explicit click** | ✅ Already compliant — no autoplay on load, official embed, no download/proxy |
| 7 | `featured_video_id` thumbnail (`img.youtube.com/vi/.../hqdefault.jpg`) | Used as a static image fallback (not embed) on `ArtistCard`, `FeedCard`, Founding Believer page | ✅ Public keyless CDN URL, no API quota, no ToS issue |
| 8 | `momentum_score` | Stored only on `discovery_candidates`, shown only in internal Discovery queue as Scout-decision context; never written to `artists`, never public | ✅ Already never public — but see note below |

**Note on Momentum Score vs. brief section 8:** the brief says "do not use
YouTube API metrics to calculate a new proprietary Momentum Score" and "do
not automatically calculate a NEXT/Scout score mathematically from
YouTube views/likes/comments/subscribers." The audit shows Momentum Score
already never becomes a NEXT Score or Breakout Score component — it only
gates which YouTube uploads get created as a `discovery_candidates` row
for a human Scout to Approve/Watch/Pass. That's arguably already exactly
the "use YouTube to locate candidates, then human judgment decides" model
the brief asks for. **Open question for you:** do you want me to (a) keep
Momentum Score exactly as-is (internal candidate-surfacing heuristic
only), (b) keep the underlying metrics visible to Scouts but stop
computing a single blended "score" number out of them (show the raw
signals instead), or (c) remove automatic scoring entirely and just list
candidates chronologically for Scouts to judge unaided? I'd lean toward
(a) — it's not public, it's not a NEXT/Breakout score, and it's genuinely
useful triage — but this is a judgment call the brief left ambiguous
enough that I want your call before touching it.

## 5. Full public-field audit table

Format: **UI field → current source → DB field → API/service → proposed
free replacement.** Covers every surface listed in the brief (Discover
cards / Artist Detail / Feed cards / Watchlist / Portfolio / Leaderboard /
Founding Believer / artist submissions / artist claim pages).

| UI field | Current source | DB field(s) | API/service | Proposed replacement |
|---|---|---|---|---|
| Artist name | Scout entry | `artists.name` | none | **No change** (NEXT-first-party) |
| Artist photo | Soundcharts photo → Deezer photo → manual → gradient fallback (priority varies by component — see finding below) | `artists.photo_url` | Soundcharts / Deezer | 1) artist-provided (claim) 2) Wikimedia Commons (licensed) 3) `ArtistAvatar` gradient/initials fallback |
| Genre | Scout entry | `artists.genre` | none | No change; **optional** Wikidata cross-check/enrichment, never overrides Scout entry without review |
| Country/location | Scout entry, sometimes Soundcharts-filled | `artists.location` | Soundcharts (optional) | Scout entry primary; **optional** Wikidata enrichment with provenance tag |
| Bio | Scout entry | `artists.bio` | none | No change; **optional** Wikidata enrichment (clearly marked, never silently overwrites) |
| Social/platform links | Scout entry, sometimes Soundcharts `platformIdentifiers` | `spotify_url`,`instagram_url`,`tiktok_url`,`youtube_url` | Soundcharts (optional) | Scout entry + claimed-artist self-edit; **optional** Wikidata `official website`/identifiers |
| Follower counts | Soundcharts | `followers_count`,`monthly_listeners` | Soundcharts | **Removed from public rendering.** Kept internal/Scout-only until/unless a first-party or Wikidata-sourced number exists |
| Growth % | Soundcharts | `growth_velocity_pct` | Soundcharts | **Removed from public rendering**, replaced on public surfaces by NEXT-first-party "NEXT volume +X%" style signal |
| Engagement metrics | Never actually auto-populated (see §3 note) | `engagement_rate_pct` | — | Already Scout-manual; no change needed beyond labeling |
| "Linked to live data source" badge | Soundcharts UUID presence | `soundcharts_uuid != null` | Soundcharts | **Removed entirely** |
| Featured song / top song | Deezer | `top_song_url` | Deezer | **Removed.** Replaced by official YouTube video (already have `featured_video_id`) |
| Preview audio | Deezer 30s mp3, played via `AudioPreview` | `song_preview_url` | Deezer | **Removed.** Replace with the existing `VideoBanner` YouTube embed pattern (visible official player, click-to-play, no autoplay-on-load); if no valid video, show "No music preview available yet" |
| Featured video | YouTube (already compliant embed) | `featured_video_id`,`featured_video_match_type` | YouTube Data API v3 | **No change** — already compliant |
| YouTube thumbnail fallback | YouTube keyless CDN | `featured_video_id` | YouTube (no quota) | **No change** — already compliant, zero-cost |
| NEXT Score | Computed (`lib/scoring.ts` `breakoutScore()`) from Scout-rated categories + `growth_velocity`/`engagement_quality` | `artists.*` rating columns | Formula only, Soundcharts feeds 1 of 8 inputs | `growth_velocity` category migrates to Scout-manual-rated (see §6); rest unchanged |
| NEXT Price | Computed (`lib/next-market.ts`), driven by paper-trading volume | `next_price_history`,`next_transactions` | None (first-party) | **No change** — already first-party |
| Momentum/signals shown publicly | **None today** — Momentum Score is internal-only | `discovery_candidates.momentum_score` | YouTube | No public change needed; add **new** first-party public signals (Trending/Most Backed/etc, task #30) alongside, not replacing anything |
| Discover card sort options | Mix of `growth_velocity_pct` (Soundcharts) + first-party (watch/backer counts, price change) | various | Soundcharts (partial) | Drop Soundcharts-based sort option; keep/expand first-party sort options |
| Feed card hero image/audio | Same photo/audio chain as Discover card | `photo_url`,`song_preview_url`,`featured_video_id` | Deezer/YouTube | Same replacement as artist photo/preview audio above |
| Watchlist / Portfolio / Leaderboard | Reuse `ArtistCard`/`DiscoverGrid`; user avatars via `ArtistAvatar` (first-party `avatar_url`) | `artists.photo_url`,`users.avatar_url` | Deezer/Soundcharts (artist photo only) | Same photo replacement; user avatars already first-party, no change |
| Founding Believer card/page hero image | Same photo/video-thumbnail chain | `photo_url`,`featured_video_id` | Deezer/YouTube | Same replacement. The downloadable OG-image card itself renders **text/stats only**, no external image fetch inside the image generator — already zero-risk there |
| Artist submissions (`/next/submit-artist`) | Pure first-party form → `discovery_candidates` | `discovery_candidates.submitted_by_user_id`,`submission_url` | None | **No change** — already zero-cost, already first-party |
| Artist claim pages | First-party claim flow (`ClaimArtistPanel`) | `artist_claims`,`artists.claimed_by_user_id` | None | **No change**, but this is exactly where task #26 (claimed-artist self-service editing) extends the existing system |

**Photo-priority inconsistency found:** the "priority chain" for an
artist's image is currently duplicated three different ways across
components rather than centralized: `ArtistCard`/`FeedCard`/Founding
Believer page try `photo_url` **then** YouTube-thumbnail-from-video;
`VideoBanner` tries the YouTube thumbnail **first**, `photo_url` second;
`FeaturedArtist` uses `photo_url` only with no video-thumbnail step at
all. Centralizing this into one shared helper (with the new priority:
artist-provided → Commons → gradient fallback, video-thumbnail dropped as
a *photo* source now that it's not needed to hide the Deezer gap) is part
of task #22.

## 6. Breakout Score categories

| Category | Weight | Type today | Plan |
|---|---|---|---|
| Music/Talent | 25 | Scout-rated | No change |
| **Growth Velocity** | 15 | **Auto: `sqrt(clamp(soundcharts growth%,0,50)/50)*10`** | Migrate to Scout-manual 0-10 rating, clearly labeled "manually rated pending first-party growth signal," existing computed values preserved as history, not reset |
| **Engagement Quality** | 15 | Schema-auto but never actually populated by current Soundcharts code — already de-facto manual | Formalize as Scout-manual (no computation change needed, just relabel/unlock the field for direct editing if it isn't already) |
| Original-Song Response | 15 | Scout-rated | No change |
| Brand/Personality | 10 | Scout-rated | No change |
| Content Consistency | 10 | Scout-rated | No change |
| Commercial Potential | 5 | Scout-rated | No change |
| Professionalism | 5 | Scout-rated | No change |

Only **1 of 8** categories (Growth Velocity) actually needs a real
migration; Engagement Quality just needs confirmation/labeling since it
was never live-automated to begin with.

## 7. NEXT first-party data already available (for task #30 signals)

Confirmed real, queryable, first-party tables: `next_transactions` /
`next_price_history` / `next_holdings` (trading volume, price moves),
`next_watchlist` (adds), `feed_reactions` / `feed_reaction_taps` (7,
8) / `feed_user_posts` (User Takes), `next_founding_believers` (backer
counts/rank), `discovery_candidates` where `source='public_submission'`
(community submissions), `analytics_events` / `preview_listens` (page/listen
activity). All sufficient to build "Trending on NEXT," "+42 Watchlists in
7 days," "N new backers," "NEXT volume +X%," "Most discussed today" purely
from first-party data — no external API needed for any of it.

## 8. What's already compliant, no work needed

- Featured-video embed (`VideoBanner`): official iframe, click-to-play
  only, `youtube-nocookie.com`, no autoplay-on-load. ✅
- YouTube thumbnail fallback: public keyless CDN, zero quota. ✅
- Momentum Score: already internal-only, already never becomes a public
  or NEXT/Breakout score (pending your call on §4's open question). ✅
- Submit-artist flow: already zero-cost, first-party. ✅
- Founding Believer OG-image generator: text/stats only, no external
  image fetch. ✅
- All Soundcharts/Deezer/YouTube sync/backfill/discovery *routes* already
  correctly require internal session or cron secret — the leak is in what
  gets rendered/serialized from already-fetched data, not in route access
  control itself.

## 9. Sequencing question for you

Given the scope (20 more tracked tasks after this audit — schema/provenance,
Deezer photo+audio replacement, Soundcharts public gating + the two leaks
above, Wikidata, Wikimedia Commons, claimed-artist self-service expansion,
Breakout Score migration, first-party signals, Feed upload restrictions,
cleanup, QA across 6 artist states, and the final report), I'd like your
sign-off on two things before I start writing code:

1. **The Momentum Score question in §4** — keep as-is, strip to raw
   signals, or remove scoring entirely?
2. **Execution style** — should I work straight through all remaining
   phases in this session and report at the end (per the brief's own
   "Definition of done" checklist), or would you rather I check in after
   each major phase (e.g., after Deezer removal + the two leak fixes,
   before starting Soundcharts/Wikidata/Commons)? Given this touches a
   real database with real artist records, I lean toward checking in
   after the highest-risk phase (Deezer/Soundcharts public removal + the
   leak fixes) and then proceeding through the rest more continuously —
   but happy to do it however you prefer.
