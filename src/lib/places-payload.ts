import type { PlaceInput } from './db/places';
import {
  DIFFICULTIES,
  DURATION_BUCKETS,
  EXTENTS,
  VISIBILITIES,
  type Difficulty,
  type DurationBucket,
  type Extent,
  type Visibility,
} from './places-constants';

/**
 * Shape-checks a request body before it reaches the data layer, which trusts
 * its types. Content rules — trimming, limits, blanks, the derived kind — stay
 * in `normaliseInput`, so they hold for every caller rather than only for HTTP.
 *
 * The same file as `packing-list-payload.ts` in spirit, but bigger, because an
 * entry has two optional halves and a form is entirely capable of sending
 * `"3"`, `""` and `null` for the same field on three different submissions.
 */

type Parsed = { input: PlaceInput } | { message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A form sends `''` for an empty field; both mean "not set". */
function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | null | 'bad' {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 'bad';
  if (typeof value !== 'string') return 'bad';

  const parsed = Number(value.trim());

  return Number.isFinite(parsed) ? parsed : 'bad';
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null | 'bad' {
  if (value === null || value === undefined || value === '') return null;

  return allowed.includes(value as T) ? (value as T) : 'bad';
}

/** Tri-state, so `null` has to survive the trip rather than becoming `false`. */
function triState(value: unknown): boolean | null | 'bad' {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (value === 'yes' || value === 'true') return true;
  if (value === 'no' || value === 'false') return false;

  return 'bad';
}

function attributes(value: unknown): Record<string, string> | null | 'bad' {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) return 'bad';

  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== 'string')) return 'bad';

  return Object.fromEntries(entries) as Record<string, string>;
}

export function parsePlaceBody(body: Record<string, unknown>): Parsed {
  const { name } = body;
  if (typeof name !== 'string') return { message: '`name` must be a string' };

  const description = optionalString(body.description);
  if (description === undefined && body.description !== undefined) {
    return { message: '`description` must be a string' };
  }

  const access = optionalString(body.access);
  if (access === undefined && body.access !== undefined) {
    return { message: '`access` must be a string' };
  }

  const mapsUrl = optionalString(body.mapsUrl);
  if (mapsUrl === undefined && body.mapsUrl !== undefined) {
    return { message: '`mapsUrl` must be a string' };
  }

  const rating = optionalNumber(body.rating);
  if (rating === 'bad') return { message: '`rating` must be a number' };

  const visibility = oneOf<Visibility>(body.visibility, VISIBILITIES);
  if (visibility === 'bad') return { message: '`visibility` is not one of the allowed values' };

  const extent = oneOf<Extent>(body.extent, EXTENTS);
  if (extent === 'bad') return { message: '`extent` is not one of the allowed values' };

  const lat = optionalNumber(body.lat);
  const lng = optionalNumber(body.lng);
  if (lat === 'bad' || lng === 'bad') {
    return { message: '`lat` and `lng` must be numbers' };
  }

  const seasons = optionalNumber(body.seasons);
  if (seasons === 'bad') return { message: '`seasons` must be a number' };

  let bbox: PlaceInput['bbox'] = null;
  if (body.bbox !== null && body.bbox !== undefined) {
    if (!isObject(body.bbox)) return { message: '`bbox` must be an object' };

    const corners = ['minLat', 'minLng', 'maxLat', 'maxLng'].map((key) =>
      optionalNumber((body.bbox as Record<string, unknown>)[key]),
    );
    if (corners.some((corner) => corner === 'bad' || corner === null)) {
      return { message: '`bbox` needs all four corners as numbers' };
    }

    const [minLat, minLng, maxLat, maxLng] = corners as number[];
    bbox = { minLat, minLng, maxLat, maxLng };
  }

  const location = parseLocation(body.location);
  if ('message' in location) return location;

  const activity = parseActivity(body.activity);
  if ('message' in activity) return activity;

  const photos = parsePhotos(body.photos);
  if ('message' in photos) return photos;

  return {
    input: {
      name,
      description,
      access,
      mapsUrl,
      rating,
      visibility: visibility ?? undefined,
      lat,
      lng,
      extent: extent ?? undefined,
      bbox,
      seasons: seasons ?? undefined,
      location: location.value,
      activity: activity.value,
      photos: photos.value,
    },
  };
}

function parseLocation(
  value: unknown,
): { value: PlaceInput['location'] } | { message: string } {
  if (value === null || value === undefined) return { value: null };
  if (!isObject(value)) return { message: '`location` must be an object' };
  if (typeof value.typeId !== 'string') {
    return { message: '`location.typeId` must be a string' };
  }

  const extras = attributes(value.attributes);
  if (extras === 'bad') {
    return { message: '`location.attributes` must be an object of strings' };
  }

  return { value: { typeId: value.typeId, attributes: extras } };
}

function parseActivity(
  value: unknown,
): { value: PlaceInput['activity'] } | { message: string } {
  if (value === null || value === undefined) return { value: null };
  if (!isObject(value)) return { message: '`activity` must be an object' };
  if (typeof value.typeId !== 'string') {
    return { message: '`activity.typeId` must be a string' };
  }

  const difficulty = oneOf<Difficulty>(value.difficulty, DIFFICULTIES);
  if (difficulty === 'bad') return { message: '`activity.difficulty` is not one of the allowed values' };

  const durationBucket = oneOf<DurationBucket>(
    value.durationBucket,
    DURATION_BUCKETS,
  );
  if (durationBucket === 'bad') {
    return { message: '`activity.durationBucket` is not one of the allowed values' };
  }

  const durationMinutes = optionalNumber(value.durationMinutes);
  const distanceM = optionalNumber(value.distanceM);
  const ascentM = optionalNumber(value.ascentM);
  if (durationMinutes === 'bad' || distanceM === 'bad' || ascentM === 'bad') {
    return { message: '`activity` numbers must be numbers' };
  }

  const familyFriendly = triState(value.familyFriendly);
  if (familyFriendly === 'bad') {
    return { message: '`activity.familyFriendly` must be true, false or null' };
  }

  const extras = attributes(value.attributes);
  if (extras === 'bad') {
    return { message: '`activity.attributes` must be an object of strings' };
  }

  return {
    value: {
      typeId: value.typeId,
      difficulty,
      durationBucket,
      durationMinutes,
      distanceM,
      ascentM,
      familyFriendly,
      attributes: extras,
    },
  };
}

function parsePhotos(
  value: unknown,
): { value: PlaceInput['photos'] } | { message: string } {
  if (value === null || value === undefined) return { value: [] };
  if (!Array.isArray(value)) return { message: '`photos` must be an array' };

  const photos = [];
  for (const photo of value) {
    if (!isObject(photo) || typeof photo.url !== 'string') {
      return { message: 'Each photo needs a `url`' };
    }

    const caption = optionalString(photo.caption);
    if (caption === undefined && photo.caption !== undefined) {
      return { message: '`caption` must be a string' };
    }

    // Measured by the editor, and optional in a way the rest of the body is
    // not: a client that cannot measure the file still gets to save the photo.
    // Nonsense is refused rather than silently dropped, so a caller sending
    // the wrong type hears about it.
    const width = optionalNumber(photo.width);
    if (width === 'bad') return { message: '`width` must be a number' };
    const height = optionalNumber(photo.height);
    if (height === 'bad') return { message: '`height` must be a number' };

    photos.push({ url: photo.url, caption, width, height });
  }

  return { value: photos };
}
