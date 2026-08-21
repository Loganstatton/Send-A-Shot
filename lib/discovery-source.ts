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

import { NewDiscoveryCandidate } from './db';
import { DiscoverySourceKey } from './types';

export type DiscoveryScanOutcome = {
  candidates: NewDiscoveryCandidate[];
  searchedCount: number;
  quotaUsed?: number;
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
