// Types for the art gallery site (/gallery/*). Deliberately isolated from
// Scout/NEXT's lib/types.ts — this is a separate product living in the same
// repo, not an extension of the artist-discovery app.

export type Availability = 'available' | 'reserved' | 'sold' | 'private_collection';

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  available: 'Available',
  reserved: 'Reserved',
  sold: 'Sold',
  private_collection: 'Private Collection',
};

export type PriceDisplayMode = 'public' | 'upon_request' | 'hidden';

export type ArtworkCategory =
  | 'religious'
  | 'human_emotion'
  | 'psychological'
  | 'military'
  | 'other';

export const CATEGORY_LABELS: Record<ArtworkCategory, string> = {
  religious: 'Religious',
  human_emotion: 'Human Emotion',
  psychological: 'Psychological',
  military: 'Military',
  other: 'Other',
};

export type ImageKind =
  | 'primary'
  | 'detail'
  | 'texture'
  | 'signature'
  | 'framed'
  | 'gallery_wall'
  | 'process';

export type Artwork = {
  id: number;
  created_at: string;
  updated_at: string;
  slug: string;
  title: string;
  year: number;
  medium: string;
  dimensions: string;
  short_description: string;
  story: string; // paragraphs separated by \n\n
  categories: ArtworkCategory[];
  availability: Availability;
  is_original: boolean;
  signed: boolean;
  price_cents: number | null;
  price_display_mode: PriceDisplayMode;
  edition_total: number | null;
  edition_remaining: number | null;
  edition_closed: boolean;
  artwork_code: string; // e.g. NH-2026-001
  certificate_number: string | null;
  hero_image_url: string | null;
  silhouette_image_url: string | null;
  release_at: string | null; // ISO datetime; null = already released
  is_published: boolean;
  sort_order: number;
};

export type ArtworkInput = Omit<
  Artwork,
  'id' | 'created_at' | 'updated_at' | 'categories'
> & { categories: ArtworkCategory[] };

export type ArtworkImage = {
  id: number;
  artwork_id: number;
  url: string;
  alt: string;
  kind: ImageKind;
  sort_order: number;
};

export type SymbolismHotspot = {
  id: number;
  artwork_id: number;
  label: string;
  description: string;
  x_pct: number; // 0-100, position on the primary image
  y_pct: number;
  sort_order: number;
};

export type ProvenanceKind = 'exhibition' | 'publication' | 'award' | 'ownership' | 'gallery';

export const PROVENANCE_LABELS: Record<ProvenanceKind, string> = {
  exhibition: 'Exhibition',
  publication: 'Publication',
  award: 'Award',
  ownership: 'Previous Ownership',
  gallery: 'Gallery Appearance',
};

export type ProvenanceEntry = {
  id: number;
  artwork_id: number;
  kind: ProvenanceKind;
  title: string;
  detail: string | null;
  date_text: string | null;
  sort_order: number;
};

export type InquiryStatus = 'new' | 'responded' | 'closed';

export type Inquiry = {
  id: number;
  created_at: string;
  artwork_id: number | null;
  artwork_title_snapshot: string | null;
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
  message: string;
  status: InquiryStatus;
};

export type InquiryInput = {
  artwork_id: number | null;
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
  message: string;
};

export type CollectorEmail = {
  id: number;
  created_at: string;
  email: string;
  source: string;
};

export type SubmissionStatus = 'new' | 'reviewed' | 'used';

export type Submission = {
  id: number;
  created_at: string;
  name: string;
  story: string;
  photo_url: string | null;
  permission_granted: boolean;
  status: SubmissionStatus;
};

export type SubmissionInput = {
  name: string;
  story: string;
  photo_url: string | null;
  permission_granted: boolean;
};

export type Story = {
  id: number;
  created_at: string;
  slug: string;
  title: string;
  dek: string;
  body: string;
  cover_image_url: string | null;
  published_at: string | null;
  is_published: boolean;
  sort_order: number;
};

export type ArtworkFull = Artwork & {
  images: ArtworkImage[];
  symbolism: SymbolismHotspot[];
  provenance: ProvenanceEntry[];
};
