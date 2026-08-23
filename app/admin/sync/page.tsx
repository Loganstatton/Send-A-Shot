import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import {
  getAllArtists, getArtistsMissingTopSong, getArtistsMissingVideo, getArtistsWithSoundchartsLink,
  getLatestSyncRun, getRecentSyncFailures, getUnverifiedVideoMatchCount,
} from '@/lib/db';
import AdminTabs from '@/components/AdminTabs';
import { SyncRun } from '@/lib/types';

export const metadata: Metadata = { title: { absolute: 'Sync health — Scout' } };
export const dynamic = 'force-dynamic';

function SyncRunSummary({ label, run }: { label: string; run: SyncRun | undefined }) {
  if (!run) {
    return (
      <div>
        <span className="font-semibold">{label}</span>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>Never run.</p>
      </div>
    );
  }
  return (
    <div>
      <span className="font-semibold">{label}</span>
      <p className="num text-sm" style={{ color: 'var(--text-muted)' }}>
        {new Date(run.started_at).toLocaleString()} —{' '}
        {run.status === 'failed' ? (
          <span style={{ color: 'var(--down)' }}>failed: {run.error}</span>
        ) : (
          <>
            checked {run.checked_count}, updated {run.updated_count}
            {run.failed_count > 0 && <span style={{ color: 'var(--down)' }}>, {run.failed_count} failed</span>}
          </>
        )}
      </p>
    </div>
  );
}

export default async function AdminSyncPage() {
  await requireAdmin();

  const soundcharts = getLatestSyncRun('soundcharts');
  const deezer = getLatestSyncRun('deezer');
  const youtube = getLatestSyncRun('youtube_video');
  const failures = getRecentSyncFailures(undefined, 20);

  const totalArtists = getAllArtists().length;
  const soundchartsLinked = getArtistsWithSoundchartsLink().length;
  const missingPreview = getArtistsMissingTopSong().length;
  const missingVideo = getArtistsMissingVideo().length;
  const unverifiedVideo = getUnverifiedVideoMatchCount();

  return (
    <div className="space-y-6">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-bold">Sync health</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          External-data reliability across the whole roster — the dashboard&apos;s sync buttons only
          show the most recent run; this is the full picture, including which specific artists failed.
        </p>
      </div>

      <div className="card space-y-4">
        <h2 className="font-bold text-lg">Latest runs</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SyncRunSummary label="Soundcharts" run={soundcharts} />
          <SyncRunSummary label="Deezer" run={deezer} />
          <SyncRunSummary label="YouTube video" run={youtube} />
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-lg">Roster coverage</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="num text-xl font-semibold">{totalArtists}</p>
            <p style={{ color: 'var(--text-faint)' }}>artists tracked</p>
          </div>
          <div>
            <p className="num text-xl font-semibold">{soundchartsLinked}</p>
            <p style={{ color: 'var(--text-faint)' }}>linked to Soundcharts</p>
          </div>
          <div>
            <p className="num text-xl font-semibold">{missingPreview}</p>
            <p style={{ color: 'var(--text-faint)' }}>missing a Deezer preview</p>
          </div>
          <div>
            <p className="num text-xl font-semibold">{missingVideo}</p>
            <p style={{ color: 'var(--text-faint)' }}>missing a featured video</p>
          </div>
        </div>
        {unverifiedVideo > 0 && (
          <p className="text-sm" style={{ color: 'var(--down)' }}>
            ⚠ {unverifiedVideo} artist{unverifiedVideo === 1 ? '' : 's'} have a featured video matched via
            unverified search — worth a manual check, since it may be the wrong artist.
          </p>
        )}
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-lg">Recent failures</h2>
        {failures.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No sync failures logged.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]" style={{ borderCollapse: 'collapse' }}>
              <thead className="text-left">
                <tr>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>When</th>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Source</th>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Artist</th>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Error</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f) => (
                  <tr key={f.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td className="py-2 pr-3 num" style={{ color: 'var(--text-faint)' }}>{new Date(f.created_at).toLocaleString()}</td>
                    <td className="py-2 pr-3">{f.source}</td>
                    <td className="py-2 pr-3"><a className="underline" href={`/artists/${f.artist_id}`}>{f.artist_name}</a></td>
                    <td className="py-2" style={{ color: 'var(--down)' }}>{f.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
