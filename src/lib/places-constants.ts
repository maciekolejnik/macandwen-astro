/**
 * The vocabulary and limits of the places feature, in a module the browser can
 * import without pulling in Drizzle and the D1 binding — the same reason
 * `packing-list-limits.ts` exists.
 */

export const NAME_MAX_LENGTH = 120;
export const DESCRIPTION_MAX_LENGTH = 4000;
export const ACCESS_MAX_LENGTH = 500;
export const NOTE_MAX_LENGTH = 500;
export const CAPTION_MAX_LENGTH = 200;
export const URL_MAX_LENGTH = 2000;
export const MAX_PHOTOS = 20;

export const KINDS = ['location', 'activity', 'both'] as const;
export type Kind = (typeof KINDS)[number];

/** The two vocabularies of `entry_type`. An entry's kind may also be 'both'. */
export const TYPE_KINDS = ['location', 'activity'] as const;
export type TypeKind = (typeof TYPE_KINDS)[number];

export const VISIBILITIES = ['private', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const EXTENTS = ['point', 'area', 'region'] as const;
export type Extent = (typeof EXTENTS)[number];

export const DIFFICULTIES = ['easy', 'moderate', 'difficult'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DURATION_BUCKETS = [
  'short',
  'half_day',
  'full_day',
  'multi_day',
] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];

export const DURATION_LABELS: Record<DurationBucket, string> = {
  short: 'A couple of hours',
  half_day: 'Half a day',
  full_day: 'A full day',
  multi_day: 'More than a day',
};

/**
 * Minutes are optional decoration; the bucket is what gets stored, filtered
 * and indexed. Deriving at write time is what keeps the two from disagreeing.
 */
export function bucketForMinutes(minutes: number): DurationBucket {
  if (minutes < 180) return 'short';
  if (minutes < 360) return 'half_day';
  if (minutes < 720) return 'full_day';
  return 'multi_day';
}

export const MIN_RATING = 1;
export const MAX_RATING = 5;

/**
 * Stars are the input, but these are what a star *means*. Writing them down is
 * the whole point: an uncalibrated five-point scale collapses into "everything
 * I bothered to save is a four", and the middle of it dies. Naming each step
 * makes picking one a judgement rather than a mood, and gives the star row
 * something to say to a screen reader.
 */
export const RATING_LABELS: Record<number, string> = {
  1: 'Not worth it',
  2: 'Fine, nothing special',
  3: 'Good, worth going',
  4: 'Excellent, would go back',
  5: 'Must see',
};

export const RATINGS = [1, 2, 3, 4, 5] as const;

export const SEASONS = {
  spring: 1,
  summer: 2,
  autumn: 4,
  winter: 8,
} as const;
export type Season = keyof typeof SEASONS;

/** 0 means "any time", so an unrestricted entry is never excluded by a filter. */
export const ANY_SEASON = 0;
export const ALL_SEASONS = 15;

export function seasonsToMask(seasons: readonly Season[]): number {
  return seasons.reduce((mask, season) => mask | SEASONS[season], 0);
}

export function maskToSeasons(mask: number): Season[] {
  return (Object.keys(SEASONS) as Season[]).filter(
    (season) => (mask & SEASONS[season]) !== 0,
  );
}

/**
 * Relations are a fixed vocabulary rather than free text: "parking" and
 * "park at" written by two people would stop the graph answering questions.
 * Adding one is a code change, unlike adding a type — types are vocabulary,
 * relations are structure that queries and copy depend on.
 *
 * `symmetric` relations mean the same thing read from either end, so a query
 * unions both directions; the rest read differently and carry a second label.
 */
export const RELATIONS = {
  starts_at: { label: 'Starts at', inverse: 'Starting point for', symmetric: false },
  parks_at: { label: 'Park at', inverse: 'Parking for', symmetric: false },
  passes_through: { label: 'Passes through', inverse: 'On the way of', symmetric: false },
  ends_at: { label: 'Ends at', inverse: 'Finishing point for', symmetric: false },
  inside: { label: 'Part of', inverse: 'Contains', symmetric: false },
  near: { label: 'Near', inverse: 'Near', symmetric: true },
  related: { label: 'See also', inverse: 'See also', symmetric: true },
} as const;

export type Relation = keyof typeof RELATIONS;

export const RELATION_NAMES = Object.keys(RELATIONS) as Relation[];

export function isRelation(value: string): value is Relation {
  return Object.hasOwn(RELATIONS, value);
}

/**
 * Slugs are derived once and then frozen, so a shared link keeps working after
 * a rename. Accents are stripped rather than dropped, so "Banyoles" and
 * "Bañolas" both produce something readable.
 */
export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');

  // A name of nothing but punctuation still needs an addressable slug.
  return base || 'place';
}

/** Accepts "42.1, 2.7" — what copying a pin out of Google Maps gives you. */
export function parseCoordinates(
  value: string,
): { lat: number; lng: number } | null {
  const match = value
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) return null;

  return { lat, lng };
}

export function isValidLatitude(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLongitude(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}
