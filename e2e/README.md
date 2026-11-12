# Browser test suites

End-to-end checks that drive a real browser (Playwright/Chromium) against a
**production build** of the app and a real Postgres database. They cover
the flows the unit tests can't: signing up from a share link, onboarding,
leagues, challenges, discovery pages, artist requests, analytics, security
behaviour over HTTP, and keyboard access.

## Running

```bash
npm run db:dev      # starts the local Postgres (port 54329) — once
npm run build
npm run test:e2e    # all suites; or: node e2e/run-all.js leagues security
```

Each suite starts its own `next start` on a fixed port (3100–3120) and works
in its own fresh Postgres schema or database, so suites never see each
other's data. Screenshots land in `e2e/screenshots/` (git-ignored).

| Suite | What it checks |
|---|---|
| `main` | Scout + NEXT core: accounts, artists, trading, portfolio, leaderboard, admin |
| `guest` | Signed-out browsing, sign up from an artist page, proof links and previews |
| `leagues` | Create/invite/join, standings since joining, owner controls, privacy |
| `onboarding` | Accessible onboarding dialog, genre picks, "For you", Settings |
| `challenges` | Weekly challenges and track record |
| `discovery` | Genre pages, editorial collections, artist navigation |
| `artist-requests` | Reports, corrections, opt-out, staff queue |
| `analytics` | Signup attribution, activity pulse, beta feedback |
| `security` | Headers, login limits, sessions, CSRF, authorization, injection |
| `social` | Notification settings, feed hide/mute, league activity |
| `keyboard-check` | Skip link and focus outlines |
| `axe-audit` | WCAG 2.1 A/AA scan with axe-core (needs `npm i -D axe-core`, or `AXE_PATH`) |

`E2E_DEV_DB` overrides the database URL (default
`postgresql://postgres@127.0.0.1:54329/sas_dev`).
