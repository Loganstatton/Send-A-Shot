// eslint-disable-next-line @next/next/no-img-element -- artist photos are
// arbitrary external URLs (Scout-entered), not something next/image's
// static optimization pipeline is set up for.
export default function ArtistAvatar({
  name,
  photoUrl,
  size = 'md',
}: {
  name: string;
  photoUrl?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dims = size === 'lg' ? 'w-20 h-20 text-2xl' : size === 'sm' ? 'w-10 h-10 text-sm' : 'w-14 h-14 text-lg';
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        loading="lazy"
        decoding="async"
        className={`${dims} rounded-full object-cover shrink-0`}
        style={{ background: 'var(--surface-2)' }}
      />
    );
  }

  return (
    <div
      className={`${dims} rounded-full shrink-0 flex items-center justify-center font-semibold`}
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
    >
      {initial}
    </div>
  );
}
