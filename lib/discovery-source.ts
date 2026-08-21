// The shared shape every Discovery source produces. This — not a forced
// polymorphic scan() call — is the actual abstraction the Candidate Queue
// is built on: any source, present or future (YouTube, a Scout's own
// submission, an artist self-submission, a different discovery API),
// just needs to produce NewDiscoveryCandidate rows with a `source` tag and
// call insertDiscoveryCandidate(). See lib/youtube-discovery.ts for the
// concrete YouTube implementation.
//
// The existing Soundcharts scan (app/api/discovery/scan/route.ts,
// lib/discovery.ts) predates this file and isn't rewired through it here —
// it already produces the same NewDiscoveryCandidate shape and was left
// untouched to avoid regressing shipped, working code. It fits this same
// shape and could be adapted to implement DiscoverySource later with no
// behavior change.

import type { NewDiscoveryCandidate } from './db';
import type { DiscoverySourceKey } from './types';

// Why the candidates that DIDN'T qualify got rejected — optional because
// only sources that do their own qualification filtering (currently just
// YouTube) have anything to report here. Answers "did we find nothing
// because nothing was there, or because a threshold/data gap silently
// filtered everything?" without guessing.
export type DiscoveryRejectionBreakdown = {
  belowMinViews: number;
  noSubscriberCount: number;
  subscriberOutOfBand: number;
  belowMomentumThreshold: number;
  bestRejectedMomentumScore?: number; // the closest miss among belowMomentumThreshold rejections
};

export type DiscoveryScanOutcome = {
  candidates: NewDiscoveryCandidate[];
  searchedCount: number;
  quotaUsed?: number;
  rejectionBreakdown?: DiscoveryRejectionBreakdown;
};

// The identity sets a source needs to avoid re-flagging something already
// tracked on NEXT or already reviewed (approved/watched/passed) — checked
// against whatever identity that source's candidates key off of.
export type KnownIdentitySets = {
  soundchartsUuids: Set<string>;
  youtubeChannelIds: Set<string>;
};

export interface DiscoverySource {
  key: DiscoverySourceKey;
  scan(known: KnownIdentitySets): Promise<DiscoveryScanOutcome>;
}
