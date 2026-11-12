# Verified growth data: sources, terms and costs

Goal: fill the artist page's **Verified Momentum** panel with real-world
growth (followers, subscribers, listeners over time), each number labelled
with its source and date. It stays separate from the Scout Score and the
virtual Price, and is never blended into either.

Researched 2026-11-12 from provider docs and 2026 comparison sources.
Terms change: re-check each provider's current terms before launch. This
is not legal advice; the open questions are in LEGAL-REVIEW.md.

## Free sources

| Source | What it gives | Terms for an app like NEXT | Verdict |
|---|---|---|---|
| **YouTube Data API** (already integrated) | Channel subscribers, total views, per-video views | Free (10,000 quota units/day). Without the channel owner's authorization, statistics **may not be stored more than 30 days**. Graphs of raw metrics (e.g. subscriber increase) are acceptable; new or derived metrics are not, except for audited developers granted permission. Metrics must not be mixed with other sources. | **Usable now** as a 30-day window: current count plus the raw change over the last ≤30 days, source and date shown, older data deleted. |
| **YouTube, artist-authorized** (OAuth, channel owner signs in) | The same statistics for that artist's own channel, kept longer | Allowed with the owner's authorization, re-checked at least every 30 days; delete within 30 days if revoked. Needs Google OAuth app verification for the read-only YouTube scope (free; takes time). | **Best long-term free option** for claimed artists. Builds on the existing artist-claim flow. |
| **Wikipedia pageviews** (Wikimedia Analytics API) | Daily article views: a public-attention signal | CC0 data; free; needs a descriptive User-Agent and polite request rates. | **Usable**, but most emerging artists have no article. Nice-to-have. |
| MusicBrainz | Artist IDs, links, releases (CC0 core data) | Free, open | Useful for identity and links; **no popularity numbers**. |
| Deezer API (already used for previews/photos) | `nb_fan` (fan count) per artist | Public endpoints with no key, but Deezer "does not certify" commercial use, and the rules on storing data aren't public | **Not cleared**: ask Deezer or counsel before showing fan counts or keeping history. |
| Spotify Web API | Followers, popularity | Since Feb 2026, development-mode apps are limited to 5 allow-listed users and need a Premium developer account. Extended access requires a registered business and 250,000 monthly active users. | **Not viable** at our size. |
| Last.fm API | Listeners, play counts | Free for non-commercial use only. Commercial use needs an agreement (partners@last.fm). Breach ends access. | **Not usable** without an agreement (asking costs nothing). |

## Paid APIs (nothing purchased)

| Provider | What it adds | Price seen (2026) | Notes |
|---|---|---|---|
| Soundcharts | Spotify listeners/followers, TikTok, Instagram, YouTube, charts, history | API from ~$50/month on some listings; others say quote only. Dashboard plans $10–$129/month. | The app already has a Soundcharts client. On the plan used before, the artist endpoint returned only name/photo/country, so confirm in writing which fields the API plan includes. |
| Chartmetric | Broadest coverage; long history | Developer API ~$350 per user/month (1 request/sec) | Industry standard; expensive for a beta |
| Viberate | Multi-platform stats, 3 months' history | ~€300/month (older figure) | Re-quote |
| Songstats | Multi-platform stats | Quote only | Request a quote |

None publish a reliable current API price list. Get written quotes,
including the fields covered and the display/caching rights, before
deciding.

## Recommended plan

1. **Now (free):** YouTube 30-day window in the Verified Momentum panel, for
   artists whose YouTube channel is linked. It shows "Subscribers: N (+X in
   the last D days)" with "Source: YouTube · updated <date>". The daily job
   records counts, and anything older than 30 days is deleted. No score, no
   percentage, nothing blended into the Score or Price.
2. **Next (free, more work):** "Connect your YouTube channel" for claimed
   artists, giving authorized, longer history for those artists. Needs
   Google OAuth verification.
3. **Later (paid, your approval):** one multi-platform provider (Soundcharts
   first, since a client exists) once the beta shows players use the panel.
   Get quotes first.

## Compliance fix already made

Scout discovery candidates were storing YouTube statistics, calculated
figures and sample comments with no expiry. They are now cleared once 30
days old, on every daily scan (`lib/youtube-retention.ts`), keeping only
the channel/video IDs. Whether the Scout-only candidate figures
(views/day, like rate) count as "derived metrics" under YouTube's policy is
listed for counsel in LEGAL-REVIEW.md.
