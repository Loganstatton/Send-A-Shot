# Send‑A‑Shot (Kit) — Legal MVP

A tiny full‑stack Next.js app that lets you **send sealed mini “shot kits”** (50ml bottles + shot glass) to someone.  
**No open containers, no pouring by drivers.** This MVP is for demo/education only.

## Features
- Product catalog of sealed minis
- Cart + checkout with age‑confirm checkbox (placeholder)
- Order tracking page
- Driver console with status updates (protected by `DRIVER_KEY` env)
- SQLite (via better‑sqlite3) with auto‑seeding

## Quick Start
```bash
# Node 18+ recommended
npm i
# set a simple driver key
echo "DRIVER_KEY=let-me-in" > .env.local
npm run dev
# open http://localhost:3000
```

> **Note:** better-sqlite3 uses native bindings. On macOS/Linux it compiles automatically during `npm i`. On Windows, ensure build tools are installed or switch to a hosted Linux dev container.

## What This MVP Does Not Include
- Real ID verification (use a provider like Persona, Onfido, or Stripe Identity in production)
- Real payments (add Stripe or similar)
- Complex compliance (time windows, dry counties, tax, inventory sync, geofencing)

## Legal Reminder
This demo models a **lawful alternative** to “sending shots”: deliver **sealed** minis only. Drivers do not pour or serve alcohol. Recipient must open and pour themselves and present valid ID at handoff.

## Project Structure
```
app/                 # Next.js app router
  api/               # API routes (products, orders, driver updates)
  checkout/          # checkout page
  driver/            # driver console
  order/[id]/        # order status page
components/
lib/                 # sqlite db + helpers
data/                # sqlite file lives here
```

## Next Steps (Roadmap)
- Add ID verification SDK flow (liveness + barcode scan)
- Add Stripe checkout (test mode) and webhooks
- Add merchant/store onboarding + service areas
- Add delivery windows, tip, and taxes
- Proper auth (Clerk/Auth.js) for customer + driver
- Inventory & pricing per‑store
