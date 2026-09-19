# The Gallery — Original Pencil & Charcoal Drawings

A separate product living in this same repo/deploy, at `/gallery/*`. It does
not touch Scout/NEXT's code, database, or routes — see the root `README.md`
for that app. This file only covers the gallery site.

## Quick start

```bash
npm i
npm run dev
# open http://localhost:3000/gallery
```

The gallery uses its own SQLite file (`data/gallery.db`, separate from
Scout's `data/app.db`) and seeds a handful of sample works with generative
placeholder artwork (`public/gallery-assets/placeholder/*.svg`,
regeneratable via `node scripts/generate-gallery-placeholders.js`) so the
site never renders empty. Replace every seeded work from `/gallery/admin`.

## Becoming an admin

The gallery reuses Scout's existing auth/session system rather than a
second login stack — `/gallery/admin` is gated by the same `role ===
'admin'` check as `/admin/users`. To get admin access the first time, set
`ADMIN_EMAILS` (comma-separated) before signing up at `/signup`, same as
Scout:

```bash
echo "ADMIN_EMAILS=you@example.com" >> .env.local
```

Sign up (or log in, if the account already exists) with that email and
you're promoted to admin on the next request. From there, everything is
manageable at `/gallery/admin` — no code changes or redeploys needed to
add/edit/publish artwork.

## What's in `/gallery/admin`

- **Works** — create, edit, publish/unpublish, mark sold/private
  collection, set price display (public / upon request / hidden), set up
  limited editions, upload the hero image plus additional images (detail
  close-ups, paper/graphite texture, signature, framed-in-a-home, gallery
  wall, process), place hidden-symbolism hotspots directly on the artwork,
  add provenance entries (exhibition/publication/award/ownership/gallery —
  the section only appears on the public page once an entry exists), and
  schedule a future reveal (adds a countdown + early-access signup to the
  homepage until the reveal date).
- **Stories** — short journal/process posts for the "Stories" nav item.
- **Inquiries** — every "Acquire This Work" submission, with a status you
  can move through New → Responded → Closed.
- **Submissions** — "Become Part of the Work" story submissions. Never
  published automatically; review and follow up personally.
- **Collector List** — everyone who signed up for "Private Releases."

## Images

Uploads (admin artwork images, and public "Become Part of the Work" photos)
are written to `data/gallery-uploads/` — the same persistent-disk directory
Scout's SQLite files live in (`DATA_DIR`, see `lib/data-dir.ts`) — and
served back through `/api/gallery/uploads/[...path]`, not through Next's
`public/` folder (which is baked into the build and wouldn't survive a
redeploy). JPEG/PNG/WebP only, 8MB cap per image.

Images are rendered as plain `<img>` tags rather than `next/image`, since
neither the seed placeholders nor admin-uploaded photos carry known
width/height metadata. This is fine functionally (native lazy-loading is
still used throughout) but means no automatic responsive `srcset`
generation yet — a reasonable follow-up once real photography is uploaded
and its dimensions are known.

## Environment variables (all optional)

| Var | Effect |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Used for absolute OpenGraph image URLs, the sitemap, and robots.txt. Set this in production. |
| `NEXT_PUBLIC_GA_ID` | If set, loads Google Analytics (gtag) on `/gallery/*` only. Unset by default — zero third-party analytics until you add this. |

## Acquisition flow

"Acquire This Work" opens an inquiry form (name, email, phone, country,
message) that posts to `/api/gallery/inquiries` — no payment is taken.
This is intentional: the brief calls for the experience to feel like
acquiring from a gallery, not checking out of a store. The data model
(`gallery_artworks.price_cents` / `price_display_mode`) already supports a
real Stripe Checkout flow later; wiring it in would mean adding a "Buy Now"
path alongside the existing inquiry path for artworks where
`price_display_mode === 'public'`, without touching the inquiry flow used
for "upon request" or hidden-price pieces.

## Known limitations

- **Soft 404s / soft redirects show the right content at the wrong HTTP
  status.** This repo's root `app/loading.tsx` wraps every route (not just
  Scout's dashboard) in a Suspense boundary, which flushes a 200 response
  before an async `notFound()`/`redirect()` deeper in the tree resolves —
  a pre-existing Next.js App Router rough edge already present in Scout's
  own pages (e.g. `/admin/users` has the same characteristic). A visitor
  in a real browser sees the correct page either way; a non-JS client or
  crawler would see a 200 with 404-shaped content for a missing artwork
  slug. `/gallery/admin/*` is hardened against this specifically via
  `middleware.ts`, which does a real HTTP-level redirect before any
  rendering starts — that was the one place this mattered for access
  control, since the inquiry/upload/CRUD API routes were already gated
  with plain 401 JSON responses rather than `redirect()`.
- **No payment processing yet** — see "Acquisition flow" above.
- **Certificates of authenticity** are tracked as data (`artwork_code`,
  `certificate_number`) but there's no downloadable PDF generator yet.
