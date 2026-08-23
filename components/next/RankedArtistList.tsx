import Link from 'next/link';
import ArtistAvatar from '@/components/ArtistAvatar';

export type RankedArtistItem = {
  artist_id: number;
  artist_name: string;
  photo_url?: string;
  value: string;
  valueTone?: 'up' | 'down';
  subtitle?: string;
};

// One shared shape for every "top N artists" panel on the Market Activity
// page (biggest movers, most active, most backed/watched today, new this
// week) — same ranked-row layout the Leaderboard and Watchlist already use.
export default function RankedArtistList({ title, items, emptyMessage }: { title: string; items: RankedArtistItem[]; emptyMessage: string }) {
  return (
    <div className="next-card p-5 flex flex-col gap-3">
      <h3 className="font-display font-bold text-[15px] m-0">{title}</h3>
      {items.length === 0 ? (
        <p className="m-0 py-4 text-center text-xs" style={{ color: 'var(--text-faint)' }}>{emptyMessage}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item, i) => (
            <Link key={item.artist_id} href={`/next/artists/${item.artist_id}`} className="flex items-center gap-2.5 hover:opacity-80">
              <span className="num w-4 text-center text-xs shrink-0" style={{ color: 'var(--text-faint)' }}>{i + 1}</span>
              <ArtistAvatar name={item.artist_name} photoUrl={item.photo_url} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium truncate">{item.artist_name}</div>
                {item.subtitle && <div className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{item.subtitle}</div>}
              </div>
              <span
                className="num text-[13px] font-semibold shrink-0"
                style={{ color: item.valueTone === 'up' ? 'var(--up)' : item.valueTone === 'down' ? 'var(--down)' : 'var(--text)' }}
              >
                {item.value}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
