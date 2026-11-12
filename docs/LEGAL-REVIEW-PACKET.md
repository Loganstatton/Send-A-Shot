# Legal review packet: NEXT (beta)

Prepared 2026-11-12 for outside counsel. It describes what the product does
today. **It is not legal advice.** The detailed per-area question list is in
[LEGAL-REVIEW.md](LEGAL-REVIEW.md); this packet adds the context counsel
needs and the priority order.

## 1. What NEXT is (one paragraph for counsel)

NEXT is a free web game. Players get **virtual credits** at signup and
"back" (buy) and "sell" positions in emerging music artists. Prices move
with player trading in the game. A separate rating (the Scout Score) is set
by human reviewers against published guidelines. Players compete on
leaderboards, weekly challenges and private leagues. **Credits can't be
bought, sold, transferred or cashed out, there are no prizes, and backing an
artist confers no ownership of music or earnings.** The owner has decided
that all trading stays virtual for now.

## 2. Planned next steps that need sign-off

| Plan | Status | Counsel's input needed before |
|---|---|---|
| Invite-only beta, 100 real players (US-hosted; players could be anywhere) | Ready to start (invites built) | Launching the beta: age floor, Terms/Privacy, minors |
| NEXT Pro: optional $7.99/month subscription | **Survey only.** Nothing is sold and no payment data is collected. Hard rule: Pro never sells credits or trading advantages | Any paid launch: auto-renewal law, refunds/cancellation, whether a subscription changes the virtual-currency analysis |
| Verified growth data (followers/subscribers from YouTube etc.) | Research done (GROWTH-DATA-SOURCES.md) | Showing third-party statistics publicly; YouTube "derived metrics" question |
| Prizes, cash-out, sponsored placements | **Not planned** | Would require full review first |

## 3. Documents to review

1. **Terms of Service**: live at `/terms` (source `app/terms/page.tsx`)
2. **Privacy Policy**: live at `/privacy` (source `app/privacy/page.tsx`); updated today for email records, invites, survey answers and backups
3. **Signup disclosures**: `components/AuthForm.tsx` (Terms/Privacy checkbox, age statement)
4. **In-product disclosures**: footer ("free game… virtual credits… no ownership"), How it works (`/next/how-it-works`), the artist page's trade panel
5. **NEXT Pro survey page**: `/next/pro` ("doesn't exist yet, nothing to buy")
6. **Question list**: [LEGAL-REVIEW.md](LEGAL-REVIEW.md)

## 4. Personal data inventory

| Data | Why | Where | Kept | Public? |
|---|---|---|---|---|
| Name, email, password hash | Account | Render Postgres (Oregon, US) | Until account deletion | Name only |
| Trades, holdings, watchlist, leagues, genre picks | The game | Same | Until deletion | Profile/leaderboard pieces, per Privacy |
| Usage events, signup source | Product analytics (first-party only; no ad trackers) | Same | Indefinite (**retention period to decide**) | No |
| Login attempts (hashed email + IP) | Rate limiting | Same | ~1 day | No |
| Email send records (address, subject, outcome) | Detect failed account emails | Same | 90 days; deleted with account | No |
| Invite records (code, label, who used it) | Invite-only beta | Same | Indefinite (**decide**) | No |
| Pro survey answers | Pricing research | Same | Until deletion | No (aggregates to staff) |
| Feedback and reports | Product/safety | Same | Indefinite (**decide**) | No |
| Daily snapshots (all of the above) | Disaster recovery | Same database | Last 14 | No |
| Encrypted off-site snapshot | Disaster recovery | GitHub Actions artifact (AES-256-GCM; key held only on Render and by the owner) | 30 days | No (ciphertext; repository is public) |

**Processors:** Render (hosting/database), GitHub (encrypted backups; source
code), Resend (email delivery, once enabled), Google/YouTube API (artist
video data; no player data sent), Wikimedia (public artist data; no player
data sent).

## 5. Priority questions (answer before the beta starts)

1. **Age floor.** Terms say 13+. Is 13 right for a trading-style game, or
   should the beta be 18+ (or 16+ in the EU)? Do we need age gating beyond a
   checkbox?
2. **Virtual currency and gambling/securities characterisation.** With free
   credits, no purchase, no cash-out and no prizes, is anything triggered?
   Is the trading vocabulary ("portfolio", "return", "price") acceptable
   with the current disclaimers?
3. **Privacy policy completeness** for a US-hosted beta with possible EU/UK
   and California users: lawful basis, data-export/access requests,
   retention periods for the "decide" rows above, international transfer
   wording.
4. **Public ratings of real people.** Scout Scores and notes about named
   artists who haven't joined (defamation/opinion; right of publicity). Is
   the current opt-out/takedown process enough?
5. **YouTube API policy.** Statistics are now deleted after 30 days. Do the
   Scout-only candidate figures computed from YouTube statistics (views per
   day, like rate) count as prohibited "derived metrics"? If so, they can be
   removed.
6. **Email.** Does the opt-in notification digest need an unsubscribe link
   and a postal address (CAN-SPAM)? Account emails are transactional.

## 6. Before any paid tier (later)

- Subscription terms: auto-renewal disclosures, cancellation (incl.
  click-to-cancel rules), refunds, price-change notice.
- Whether selling anything changes the analysis of the free virtual
  credits. The design rule is that Pro never touches credits or standings.
- Payment processor requirements; sales tax/VAT on digital services.
- Any "early access to artists" feature: fairness disclosures in a
  competitive game.

## 7. Contact and scope

Owner: the account holder of this repository. Engineering questions about
how a feature behaves can be answered from the code. Every claim above
points to a file.
