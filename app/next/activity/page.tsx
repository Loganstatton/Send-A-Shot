import type { Metadata } from 'next';
import {
  getMarketTradeCounts, getMarketVolumeCents, getMostActiveArtists, getNewArtistsThisWeek, getNextMarket,
  getRecentBackerCountsByArtist, getRecentMarketTrades, getRecentWatchCountsByArtist,
} from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { changePctForWindow } from '@/lib/next-market';
import { formatCents } from '@/lib/format';
import { NextMarketRow } from '@/lib/types';
import NextStatTile from '@/components/next/NextStatTile';
import RankedArtistList, { RankedArtistItem } from '@/components/next/RankedArtistList';
import MarketActivityFeed from '@/components/next/MarketActivityFeed';

export const metadata: Metadata = { title: 'Market Activity' };
export const dynamic = 'force-dynamic';

// 24h is the one window used throughout this page — "today," consistently,
// for every "recent"/"today" module (movers, most active, most backed/
// watched, and the recap stats) rather than a different cutoff per module.
const WINDOW_HOURS = 24;

export default async function MarketActivityPage() {
  await requireUser();
  const rows = getNextMarket();
  const trades = getRecentMarketTrades(50);

  const volumeCents = getMarketVolumeCents(WINDOW_HOURS);
  const { buys, sells } = getMarketTradeCounts(WINDOW_HOURS);
  const activeArtists = getMostActiveArtists(WINDOW_HOURS, 5);
  const recentBackerCounts = getRecentBackerCountsByArtist(WINDOW_HOURS);
  const recentWatchCounts = getRecentWatchCountsByArtist(WINDOW_HOURS);
  const newArtists = getNewArtistsThisWeek(7);

  const byId = new Map<number, NextMarketRow>(rows.map((r) => [r.artist.id, r]));

  const movers = [...rows]
    .map((r) => ({ row: r, changePct: changePctForWindow(r.priceCents, r.priceHistory, WINDOW_HOURS) }))
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 5);
  const biggestMover = movers[0] ?? null;

  const moverItems: RankedArtistItem[] = movers.map((m) => ({
    artist_id: m.row.artist.id,
    artist_name: m.row.artist.name,
    photo_url: m.row.artist.photo_url,
    value: `${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(1)}%`,
    valueTone: m.changePct >= 0 ? 'up' : 'down',
  }));

  const activeItems: RankedArtistItem[] = activeArtists.map((a) => ({
    artist_id: a.artist_id,
    artist_name: a.artist_name,
    photo_url: byId.get(a.artist_id)?.artist.photo_url,
    value: `${a.tradeCount} trade${a.tradeCount === 1 ? '' : 's'}`,
  }));

  const backedItems: RankedArtistItem[] = Object.entries(recentBackerCounts)
    .map(([id, count]) => ({ artistId: Number(id), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(({ artistId, count }) => ({
      artist_id: artistId,
      artist_name: byId.get(artistId)?.artist.name ?? 'Unknown artist',
      photo_url: byId.get(artistId)?.artist.photo_url,
      value: `${count} backer${count === 1 ? '' : 's'}`,
    }));

  const watchedItems: RankedArtistItem[] = Object.entries(recentWatchCounts)
    .map(([id, count]) => ({ artistId: Number(id), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(({ artistId, count }) => ({
      artist_id: artistId,
      artist_name: byId.get(artistId)?.artist.name ?? 'Unknown artist',
      photo_url: byId.get(artistId)?.artist.photo_url,
      value: `${count} watch${count === 1 ? '' : 'es'}`,
    }));

  const newArtistItems: RankedArtistItem[] = newArtists.slice(0, 5).map((a) => ({
    artist_id: a.id,
    artist_name: a.name,
    photo_url: a.photo_url,
    value: a.genre ?? '',
    subtitle: a.location ?? undefined,
  }));

  type Stat = { label: string; value: string; valueTone?: 'up' | 'down' | 'ember'; delta?: string; deltaTone?: 'up' | 'down' | 'ember' };
  const recapStats: Stat[] = [
    { label: '24h volume', value: formatCents(volumeCents) },
    { label: 'Buys / Sells (24h)', value: `${buys} / ${sells}` },
    {
      label: "Today's biggest mover",
      value: biggestMover?.row.artist.name ?? '—',
      delta: biggestMover ? `${biggestMover.changePct >= 0 ? '+' : ''}${biggestMover.changePct.toFixed(1)}%` : undefined,
      deltaTone: biggestMover && biggestMover.changePct >= 0 ? 'up' : 'down',
    },
    { label: 'New artists this week', value: String(newArtists.length), valueTone: newArtists.length > 0 ? 'ember' : undefined },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display font-bold text-[34px] m-0 tracking-[-0.01em]">Market Activity</h1>
        <p className="mt-1 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>
          What&apos;s moving right now — every trade, mover, and new arrival across NEXT.
        </p>
      </div>

      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl overflow-hidden border"
        style={{ background: 'var(--border-soft)', borderColor: 'var(--border-soft)' }}
      >
        {recapStats.map((s) => <NextStatTile key={s.label} {...s} />)}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <RankedArtistList title="Biggest movers (24h)" items={moverItems} emptyMessage="No price moves yet." />
        <RankedArtistList title="Most active artists (24h)" items={activeItems} emptyMessage="No trades in the last 24h." />
        <RankedArtistList title="Most backed today" items={backedItems} emptyMessage="No new backers today." />
        <RankedArtistList title="Most watched today" items={watchedItems} emptyMessage="No new watches today." />
        <RankedArtistList title="New artists this week" items={newArtistItems} emptyMessage="No new artists this week." />
      </div>

      <MarketActivityFeed trades={trades} />
    </div>
  );
}
