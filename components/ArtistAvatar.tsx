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
        className={`${dims} rounded-full object-cover shrink-0 bg-neutral-800`}
      />
    );
  }

  return (
    <div className={`${dims} rounded-full shrink-0 bg-neutral-800 border border-neutral-700 flex items-center justify-center font-semibold text-neutral-400`}>
      {initial}
    </div>
  );
}
