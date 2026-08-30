# QuickTools API

A small, dependency-light JSON API (QR codes, text stats, password
generation, unit/color conversion, fake test data, timestamp conversion),
deployed as Vercel serverless functions. Built as a monetizable companion to
the `revenue-site/` static tools site, using the same underlying logic
exposed as endpoints for developers instead of a browser UI.

## Local development

```bash
npm i
npx vercel dev
```

## Deployment

Deployed to Vercel — see the top-level task summary for the live URL.
Redeploying just needs `npm i` then the standard Vercel deploy; there's no
build step beyond installing `qrcode`.

## Monetizing this (one-time human steps)

The code is the entire job on this side. Turning it into income needs one
account, once:

1. **List it on an API marketplace** (RapidAPI is the largest — rapidapi.com).
   Marketplaces bring their own buyer traffic (developers browsing/searching
   for APIs) instead of needing this to rank in Google from a cold domain,
   and they handle billing, metering, and payouts — no Stripe integration
   needed on this side. Sign-up needs your identity and a payout method,
   same as any marketplace seller account.
2. Set pricing tiers in the marketplace's dashboard (e.g. a free tier with a
   low daily quota, then paid tiers per call volume) — a business decision
   only you can make, not something to guess at in code.
3. Set the `RAPIDAPI_PROXY_SECRET` environment variable on the Vercel
   project to the secret RapidAPI gives you for this listing. Once set,
   `api/_util.js`'s `checkAuth()` rejects any request that doesn't carry
   that header — so only traffic routed (and billed) through the
   marketplace can reach the API; calling the raw Vercel URL directly stops
   working. Leave it unset (as it is now) while testing directly.

Until step 1 happens, this is a free, working API with no revenue
attached — same as the tools site before AdSense.

## Adding more endpoints

Each endpoint is one file under `api/`, using the
`(req, res) => {...}` Vercel serverless function signature. Copy
`api/text-stats.js` as a template — it shows the CORS/auth/JSON-response
pattern every endpoint follows via `api/_util.js`.
