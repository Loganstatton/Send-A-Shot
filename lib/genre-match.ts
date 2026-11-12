// Pure genre matching, safe to use in client components (no database).
// Artist genres are free text written by Scouts ("Pop/R&B", "Hip-Hop/Rap"),
// so matching is by the parts between slashes and commas, case-insensitive:
// liking "R&B" matches an artist tagged "Pop/R&B".

export function genreParts(genre: string): string[] {
  return genre.split(/[/,]/).map((p) => p.trim().toLowerCase()).filter(Boolean);
}

export function matchesGenrePrefs(artistGenre: string | null | undefined, prefs: string[]): boolean {
  if (!artistGenre || prefs.length === 0) return false;
  const artistParts = new Set(genreParts(artistGenre));
  return prefs.some((pref) => genreParts(pref).some((p) => artistParts.has(p)));
}
