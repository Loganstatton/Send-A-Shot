/**
 * Hardcoded FAQ content. Not schema-backed on purpose — this isn't
 * compliance-sensitive copy, editing it doesn't need an audit trail, and a
 * handful of entries doesn't warrant a table + admin CRUD surface in
 * Phase 1. If FAQ content needs to be admin-editable later, promote this
 * to a CMS-style table (see `AdminCms` in docs/05-api-design.md) rather
 * than growing this file indefinitely.
 */
export interface FaqEntry {
  question: string;
  answer: string;
}

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    question: "What's the difference between Gold Coins (GC) and Sweeps Coins (SC)?",
    answer:
      'Gold Coins (GC) are play-money credits with no cash value, used to play for fun. ' +
      'Sweeps Coins (SC) are a promotional sweepstakes currency that can be redeemed for cash ' +
      'prizes once eligibility requirements are met. SC-related features are only visible when ' +
      'enabled for your account.',
  },
  {
    question: 'How do I set deposit limits or take a break from playing?',
    answer:
      'Go to Account > Responsible Play to set daily/weekly/monthly deposit limits, a session ' +
      'reminder interval, or a cooling-off period. These tools are there to help you stay in control.',
  },
  {
    question: 'What is self-exclusion, and can I undo it?',
    answer:
      'Self-exclusion lets you lock yourself out of the platform for a set number of days or ' +
      'permanently. This is intentionally a one-way action: once set, it cannot be shortened or ' +
      'lifted through your account or by casual admin action. If you believe self-exclusion was ' +
      'applied in error, contact support — reversing it requires a manual, audited review.',
  },
  {
    question: 'Why is my Sweeps Coins (SC) balance or SC play not showing up?',
    answer:
      'SC features are feature-flagged and disabled by default at launch. If SC is not enabled ' +
      'for the platform yet, GC play is still fully available.',
  },
  {
    question: 'How do I verify my identity (KYC)?',
    answer:
      'KYC verification is required before certain actions (like redeeming SC). Go to ' +
      'Account > Verification to start the process; you may be asked to upload a photo ID and a ' +
      'selfie. Verification status is visible on your account at all times.',
  },
  {
    question: 'How do I contact support?',
    answer:
      'Open a support ticket from Account > Support. Our team responds to tickets in the order ' +
      'received; you can add follow-up messages to an existing ticket at any time.',
  },
];
