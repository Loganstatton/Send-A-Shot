# QuickTools

A small, dependency-free static site: free browser-based utilities (JSON
formatter, word counter, password generator, QR code generator, case
converter, Base64 encoder/decoder, color converter, unit converter, Markdown
previewer, Unix timestamp converter, Lorem Ipsum generator). No backend, no
build step, no framework — plain HTML/CSS/JS, deployable as-is to any static
host.

This exists as a low-maintenance path to ad revenue: the tools are evergreen
(no content to keep writing), have real, sustained search demand, and cost
nothing to host or run.

## Local preview

Any static file server works, e.g.:
```bash
npx serve revenue-site
```

## Deployment

Already deployed to Vercel as a static site — see the top-level task summary
for the live URL. To redeploy after edits, this directory just needs to be
served as static files (no build command).

## Monetizing this (one-time human steps)

These are the only steps that need a real person and cannot be automated:

1. **Traffic first.** AdSense (and most affiliate programs) want to see an
   active, original site before approving it. Give it a few weeks of
   indexing/traffic after launch before applying.
2. **Google AdSense** — sign up at https://adsense.google.com with the
   domain this site is live on. Approval needs your identity, a payout
   bank account, and tax info (Google handles this, not this repo).
3. Once approved, replace each `<div class="ad-slot">Ad space</div>` block
   across the HTML files with your AdSense `<ins class="adsbygoogle">` unit
   and add the AdSense loader script (with your `ca-pub-...` client ID) to
   the `<head>` of every page. A find-and-replace across the repo is enough
   — there's no templating layer to update.
4. Add an `ads.txt` file at the site root with the line AdSense gives you
   (`google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`) — required
   for AdSense to serve ads on this domain at all.
5. **Optional custom domain** — a `.com` costs ~$10-15/year. Buying one and
   pointing it at the Vercel deployment is a real money transaction, so it
   needs your go-ahead and payment method; the free `*.vercel.app` URL works
   fine for AdSense in the meantime (custom domain isn't required to apply).

## Adding more tools

Each tool is a self-contained folder under `tools/<name>/index.html` that
pulls in `../../assets/style.css` and `../../assets/site.js`. Copy an
existing tool folder as a template, add a card to `index.html`'s grid, and
add the URL to `sitemap.xml`.
