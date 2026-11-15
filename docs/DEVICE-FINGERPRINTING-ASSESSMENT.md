# Device fingerprinting for multi-account detection — privacy and security assessment

Status: **assessment only. Nothing here is built.** You asked for this before deciding on persistent
device fingerprinting. Phase 1 uses no device data. It relies on:
- verified-account controls and new-account limits;
- the invite graph (which account invited which);
- the behavioural "pump and dump" detector.

This is not legal advice. The legal points below are what counsel should confirm; the existing
`docs/LEGAL-REVIEW-PACKET.md` is the place to add them.

## 1. What problem it would solve

Each new account gets 10,000 free Credits. The market maker makes it impossible to *create* Credits, alone
or in a group. One person running many accounts can still *move* Credits into one account (pump and dump)
and climb the leaderboard.

Behavioural detection catches the shape of that. Device signals would add "these accounts are probably the
same person", which is the one thing behaviour can't see.

## 2. What data each option would collect

| Option | Data collected | Identifies a device? | Notes |
|---|---|---|---|
| **A. None (today)** | Nothing beyond the account, its email, invite and trades | No | Relies on limits, invites and behaviour. |
| **B. Hashed network signal at signup** | A keyed hash (HMAC with a server secret) of the IP address's network prefix and the browser family, at signup and first trade only | Weakly | The raw IP is never stored. It can't be reversed without the secret. |
| **C. First-party device cookie** | A random ID in a cookie or local storage, set at first visit, recorded at signup | Yes, per browser | Cleared by private mode or clearing data. Under EU rules it is storage on the user's device. |
| **D. Browser fingerprint** | Many attributes combined (screen, fonts, canvas/WebGL rendering, time zone, language, hardware hints) into a stable hash | Yes, across cookie clearing | The most intrusive. Usually treated as tracking. |

## 3. How long it would be stored (proposed if built)

- Keep only as long as it's useful for catching farms at signup and early trading: **30 days** from
  collection. After that it is deleted, not just hidden.
- Never in the public repository, Actions logs or analytics. Stored in its own table and readable only by
  admins.
- Visible to admins as "linked to account #N" with the strength of the link, never as the raw value.
- Included in data-export and deletion requests. Deleting an account deletes its signals.

## 4. Risk of wrongly linking real people

This is the main reason to be careful. Many unrelated real people share these signals:

- **Shared networks:**
  - households, student housing, offices, libraries and cafés share an IP address;
  - mobile carriers put many customers behind the same addresses (carrier-grade NAT);
  - VPNs and privacy relays put very large numbers of people behind a few addresses.
- **Shared devices:** family computers, school or library machines, shared tablets.
- **Identical setups:** the same phone model on the same OS version produces very similar browser
  fingerprints. Fingerprints of popular devices are far less unique than those of unusual ones.
- **Friends joining together:** an invite-only beta means people often sign up from one link, in one
  place, at the same time. That looks exactly like a farm from the network's point of view.

**Consequences if a link were trusted automatically:**
- real players would be blocked or removed from leaderboards;
- the burden would fall hardest on people in shared housing and on mobile networks;
- it would undermine the beta's trust.

**Mitigations if anything is built:**
- use it only as one input to human review, together with behaviour; never automatic action;
- require behaviour plus a link before flagging;
- tell the account why if action is ever taken, and allow an appeal.

## 5. Security risks

- **A new store of sensitive data.** Fingerprints and IP-derived data are personal data and are attractive
  in a breach. Mitigations: keyed hashing, the 30-day deletion, admin-only access, nothing in logs.
- **Evasion.** Anyone determined will use different browsers, private mode, VPNs or anti-fingerprinting
  browsers. Fingerprinting mostly catches casual multi-accounting, which the new-account limits already slow
  down.
- **Third-party scripts.** Commercial fingerprinting services mean sending visitor data to a vendor. That
  adds a processor, a contract and a cost. It also conflicts with "do not purchase services" unless you
  approve it.

## 6. Legal and policy considerations (for counsel)

- **EU/UK.** Reading or storing information on a user's device (options C and D) generally needs consent
  under the ePrivacy rules unless it is strictly necessary. Fraud prevention is argued both ways.
  Fingerprints and IP-derived data are personal data under GDPR, which brings a lawful basis, transparency,
  minimisation and a retention limit.
- **US.** Several state privacy laws treat device identifiers and "probabilistic identifiers" as personal
  information, with notice and opt-out duties.
- **App stores and browsers** increasingly restrict fingerprinting, which makes it unreliable over time.
- **Privacy policy.** Any option beyond A needs a privacy-policy update describing what is collected, why,
  and for how long.

## 7. Recommendation

1. **Don't build device fingerprinting (D) or a persistent device ID (C) now.** The beta is invite-only and
   small. The market maker already prevents Credit creation. The new-account limit caps a fresh account at
   2,500 Credits per artist per day for 3 days, and the pump detector flags the remaining pattern for
   review.
2. **Strengthen what needs no device data first:**
   - turn on `NEXT_REQUIRE_VERIFIED_EMAIL=1` once email delivery works (it needs a domain and a free Resend
     account; see `EMAIL-SETUP.md`);
   - keep invites per person;
   - review detector flags weekly.
3. **If farms show up in the flags anyway,** the least intrusive next step is option B:
   - a keyed hash of the network prefix plus browser family, at signup and first trade only;
   - deleted after 30 days;
   - shown to admins only as a review hint next to behavioural flags;
   - disclosed in the privacy policy;
   - with counsel's sign-off first.
