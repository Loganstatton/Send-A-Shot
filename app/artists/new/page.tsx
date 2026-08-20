import ArtistForm from '@/components/ArtistForm';

export default function NewArtistPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add an artist</h1>
        <p className="text-neutral-400 text-sm">Add someone you found early to the watchlist and score their breakout potential.</p>
      </div>
      <ArtistForm />
    </div>
  );
}
