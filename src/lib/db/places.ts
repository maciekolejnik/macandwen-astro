import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { getDb } from './client';
import {
  activityDetail,
  entry,
  entryLink,
  entryPhoto,
  entryType,
  entryVisit,
  locationDetail,
  user,
} from './schema';
import {
  ACCESS_MAX_LENGTH,
  ALL_SEASONS,
  CAPTION_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  DIFFICULTIES,
  DURATION_BUCKETS,
  EXTENTS,
  MAX_PHOTOS,
  NAME_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  URL_MAX_LENGTH,
  RELATIONS,
  bucketForMinutes,
  isRelation,
  isValidLatitude,
  isValidLongitude,
  slugify,
} from '../places-constants';
import type {
  Difficulty,
  DurationBucket,
  Extent,
  Kind,
  Relation,
  Visibility,
} from '../places-constants';

/**
 * Every access decision in the feature goes through `canView` and `canEdit`,
 * and no page, route or template compares `user_id` itself. That is what makes
 * households later a change to two functions rather than a search across the
 * codebase — see docs/features/places.md.
 */
export type Viewer = { id: string; role?: string | null } | null | undefined;

export type PlaceTypeRef = {
  id: string;
  slug: string;
  label: string;
  icon: string | null;
  colour: string | null;
};

export type PlaceSummary = {
  id: string;
  slug: string;
  kind: Kind;
  name: string;
  description: string | null;
  userId: string;
  ownerName: string;
  visibility: Visibility;
  isOwn: boolean;
  lat: number | null;
  lng: number | null;
  extent: Extent;
  bbox: {
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
  } | null;
  seasons: number;
  /** How to reach the point above. Belongs to the entry, not to either detail
   * row: an activity has a way in as much as a place does, and a hybrid has
   * one way in rather than two. */
  access: string | null;
  /** A link to the entry in a maps app, for navigating there. Never used to
   * place the pin — `lat`/`lng` do that. */
  mapsUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  photoUrl: string | null;
  location: {
    type: PlaceTypeRef;
    attributes: Record<string, string>;
  } | null;
  activity: {
    type: PlaceTypeRef;
    difficulty: Difficulty | null;
    durationBucket: DurationBucket | null;
    durationMinutes: number | null;
    familyFriendly: boolean | null;
    distanceM: number | null;
    ascentM: number | null;
    attributes: Record<string, string>;
  } | null;
};

export type PlacePhoto = {
  id: string;
  url: string;
  caption: string | null;
  position: number;
};

export type PlaceVisit = {
  id: string;
  visitedOn: string;
  note: string | null;
};

export type PlaceLink = {
  id: string;
  relation: Relation;
  /** How this link reads from the entry it was asked about. */
  label: string;
  note: string | null;
  other: PlaceSummary;
};

export type PlaceDetail = PlaceSummary & {
  photos: PlacePhoto[];
  visits: PlaceVisit[];
  links: PlaceLink[];
};

export type PlaceInput = {
  name: string;
  description?: string | null;
  visibility?: Visibility;
  lat?: number | null;
  lng?: number | null;
  extent?: Extent;
  bbox?: {
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
  } | null;
  seasons?: number;
  access?: string | null;
  mapsUrl?: string | null;
  location?: {
    typeId: string;
    attributes?: Record<string, string> | null;
  } | null;
  activity?: {
    typeId: string;
    difficulty?: Difficulty | null;
    durationBucket?: DurationBucket | null;
    durationMinutes?: number | null;
    familyFriendly?: boolean | null;
    distanceM?: number | null;
    ascentM?: number | null;
    attributes?: Record<string, string> | null;
  } | null;
  photos?: { url: string; caption?: string | null }[];
};

/**
 * Distinguishable from a genuine failure so callers can answer 400 rather than
 * 500, and so the message is safe to show a visitor.
 */
export class PlacesValidationError extends Error {
  readonly name = 'PlacesValidationError';
}

function invalid(message: string): never {
  throw new PlacesValidationError(message);
}

/* ------------------------------------------------------------------ access */

export function canView(
  place: { visibility: string; userId: string },
  viewer: Viewer,
): boolean {
  return place.visibility === 'public' || place.userId === viewer?.id;
}

/**
 * Ownership with no role exception: an admin is not an editor of other
 * people's writing. The admin power is over visibility, and only over their
 * own entries.
 */
export function canEdit(place: { userId: string }, viewer: Viewer): boolean {
  return Boolean(viewer?.id) && place.userId === viewer?.id;
}

export function isAdmin(viewer: Viewer): boolean {
  return viewer?.role === 'admin';
}

/** Only an admin may publish, so a normal user's entries are always private. */
function visibilityFor(viewer: Viewer, requested: Visibility | undefined) {
  return isAdmin(viewer) && requested === 'public' ? 'public' : 'private';
}

/* ------------------------------------------------------------------- reads */

const locationType = alias(entryType, 'location_type');
const activityType = alias(entryType, 'activity_type');

const firstPhotoUrl = sql<string | null>`(
  select ${entryPhoto.url} from ${entryPhoto}
  where ${entryPhoto.entryId} = ${entry.id}
  order by ${entryPhoto.position} asc limit 1
)`;

function summarySelection() {
  return {
    id: entry.id,
    slug: entry.slug,
    kind: entry.kind,
    name: entry.name,
    description: entry.description,
    userId: entry.userId,
    ownerName: user.name,
    visibility: entry.visibility,
    lat: entry.lat,
    lng: entry.lng,
    extent: entry.extent,
    bboxMinLat: entry.bboxMinLat,
    bboxMinLng: entry.bboxMinLng,
    bboxMaxLat: entry.bboxMaxLat,
    bboxMaxLng: entry.bboxMaxLng,
    seasons: entry.seasons,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    access: entry.access,
    mapsUrl: entry.mapsUrl,
    photoUrl: firstPhotoUrl,
    locationTypeId: locationType.id,
    locationTypeSlug: locationType.slug,
    locationTypeLabel: locationType.label,
    locationTypeIcon: locationType.icon,
    locationTypeColour: locationType.colour,
    locationAttributes: locationDetail.attributes,
    activityTypeId: activityType.id,
    activityTypeSlug: activityType.slug,
    activityTypeLabel: activityType.label,
    activityTypeIcon: activityType.icon,
    activityTypeColour: activityType.colour,
    difficulty: activityDetail.difficulty,
    durationBucket: activityDetail.durationBucket,
    durationMinutes: activityDetail.durationMinutes,
    familyFriendly: activityDetail.familyFriendly,
    distanceM: activityDetail.distanceM,
    ascentM: activityDetail.ascentM,
    activityAttributes: activityDetail.attributes,
  };
}

type SummaryRow = Awaited<ReturnType<typeof summaryQuery>>[number];

function toSummary(row: SummaryRow, viewer: Viewer): PlaceSummary {
  const hasBbox =
    row.bboxMinLat !== null &&
    row.bboxMinLng !== null &&
    row.bboxMaxLat !== null &&
    row.bboxMaxLng !== null;

  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind as Kind,
    name: row.name,
    description: row.description,
    userId: row.userId,
    ownerName: row.ownerName,
    visibility: row.visibility as Visibility,
    isOwn: row.userId === viewer?.id,
    lat: row.lat,
    lng: row.lng,
    extent: row.extent as Extent,
    // The four box columns are written and cleared together, so `hasBbox`
    // means all four are present — which TypeScript cannot see from a left
    // join, hence the assertions.
    bbox: hasBbox
      ? {
          minLat: row.bboxMinLat!,
          minLng: row.bboxMinLng!,
          maxLat: row.bboxMaxLat!,
          maxLng: row.bboxMaxLng!,
        }
      : null,
    seasons: row.seasons,
    access: row.access,
    mapsUrl: row.mapsUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    photoUrl: row.photoUrl ?? null,
    location: row.locationTypeId
      ? {
          type: {
            id: row.locationTypeId,
            // A joined type row is all-or-nothing: an id means the rest came
            // with it, which a left join's types cannot express.
            slug: row.locationTypeSlug!,
            label: row.locationTypeLabel!,
            icon: row.locationTypeIcon,
            colour: row.locationTypeColour,
          },
          attributes: parseAttributes(row.locationAttributes),
        }
      : null,
    activity: row.activityTypeId
      ? {
          type: {
            id: row.activityTypeId,
            slug: row.activityTypeSlug!,
            label: row.activityTypeLabel!,
            icon: row.activityTypeIcon,
            colour: row.activityTypeColour,
          },
          difficulty: row.difficulty as Difficulty | null,
          durationBucket: row.durationBucket as DurationBucket | null,
          durationMinutes: row.durationMinutes,
          familyFriendly: row.familyFriendly,
          distanceM: row.distanceM,
          ascentM: row.ascentM,
          attributes: parseAttributes(row.activityAttributes),
        }
      : null,
  };
}

function summaryQuery() {
  return getDb()
    .select(summarySelection())
    .from(entry)
    .innerJoin(user, eq(user.id, entry.userId))
    .leftJoin(locationDetail, eq(locationDetail.entryId, entry.id))
    .leftJoin(locationType, eq(locationType.id, locationDetail.typeId))
    .leftJoin(activityDetail, eq(activityDetail.entryId, entry.id))
    .leftJoin(activityType, eq(activityType.id, activityDetail.typeId));
}

/** The one visibility predicate. Never repeated in a page or a template. */
function visibleTo(viewer: Viewer) {
  return viewer?.id
    ? or(eq(entry.visibility, 'public'), eq(entry.userId, viewer.id))
    : eq(entry.visibility, 'public');
}

/** Everything the viewer may see: public entries, plus their own private ones. */
export async function listVisible(viewer: Viewer): Promise<PlaceSummary[]> {
  const rows = await summaryQuery()
    .where(visibleTo(viewer))
    .orderBy(desc(entry.createdAt));

  return rows.map((row) => toSummary(row, viewer));
}

/** Every entry owned by `userId`, private and public alike, newest first. */
export async function listOwned(userId: string): Promise<PlaceSummary[]> {
  const rows = await summaryQuery()
    .where(eq(entry.userId, userId))
    .orderBy(desc(entry.createdAt));

  return rows.map((row) => toSummary(row, { id: userId }));
}

async function findSummary(
  where: ReturnType<typeof eq>,
  viewer: Viewer,
): Promise<PlaceSummary | null> {
  const [row] = await summaryQuery().where(where).limit(1);
  if (!row) return null;

  const summary = toSummary(row, viewer);

  // Missing and forbidden answer identically, so ids cannot be probed.
  return canView(summary, viewer) ? summary : null;
}

export function getSummaryById(
  id: string,
  viewer: Viewer,
): Promise<PlaceSummary | null> {
  return findSummary(eq(entry.id, id), viewer);
}

export function getSummaryBySlug(
  slug: string,
  viewer: Viewer,
): Promise<PlaceSummary | null> {
  return findSummary(eq(entry.slug, slug), viewer);
}

async function detailFor(
  summary: PlaceSummary,
  viewer: Viewer,
): Promise<PlaceDetail> {
  const db = getDb();

  const [photos, visits, links] = await Promise.all([
    db
      .select({
        id: entryPhoto.id,
        url: entryPhoto.url,
        caption: entryPhoto.caption,
        position: entryPhoto.position,
      })
      .from(entryPhoto)
      .where(eq(entryPhoto.entryId, summary.id))
      .orderBy(asc(entryPhoto.position)),
    visitsFor(summary.id, viewer),
    linksFor(summary.id, viewer),
  ]);

  return {
    ...summary,
    photos,
    visits,
    links,
  };
}

export async function getById(
  id: string,
  viewer: Viewer,
): Promise<PlaceDetail | null> {
  const summary = await getSummaryById(id, viewer);
  return summary ? detailFor(summary, viewer) : null;
}

export async function getBySlug(
  slug: string,
  viewer: Viewer,
): Promise<PlaceDetail | null> {
  const summary = await getSummaryBySlug(slug, viewer);
  return summary ? detailFor(summary, viewer) : null;
}

function serialiseAttributes(
  attributes: Record<string, string> | null | undefined,
): string | null {
  return attributes && Object.keys(attributes).length > 0
    ? JSON.stringify(attributes)
    : null;
}

function parseAttributes(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    // Free-form extras are decoration; an unreadable blob should not take the
    // page down with it.
    return {};
  }
}

/* ------------------------------------------------------------------- links */

/**
 * A link is visible only if *both* endpoints are — otherwise a public entry
 * would leak the names of the private ones linked to it. The rule lives in the
 * query rather than the caller, so no page can get it wrong.
 *
 * Symmetric relations are unioned from both directions and read the same
 * either way; asymmetric ones carry their inverse label when read from the far
 * end, so one stored row says "park at" here and "parking for" there.
 */
export async function linksFor(
  entryId: string,
  viewer: Viewer,
): Promise<PlaceLink[]> {
  const rows = await getDb()
    .select({
      id: entryLink.id,
      relation: entryLink.relation,
      note: entryLink.note,
      fromEntryId: entryLink.fromEntryId,
      toEntryId: entryLink.toEntryId,
    })
    .from(entryLink)
    .where(or(eq(entryLink.fromEntryId, entryId), eq(entryLink.toEntryId, entryId)))
    .orderBy(asc(entryLink.createdAt));

  if (rows.length === 0) return [];

  const otherIds = rows.map((row) =>
    row.fromEntryId === entryId ? row.toEntryId : row.fromEntryId,
  );

  const others = await summaryQuery().where(
    and(inArray(entry.id, otherIds), visibleTo(viewer)),
  );
  const byId = new Map(
    others.map((row) => [row.id, toSummary(row, viewer)] as const),
  );

  return rows.flatMap((row) => {
    const outgoing = row.fromEntryId === entryId;
    const other = byId.get(outgoing ? row.toEntryId : row.fromEntryId);
    if (!other) return [];
    if (!isRelation(row.relation)) return [];

    const relation = RELATIONS[row.relation];

    return [
      {
        id: row.id,
        relation: row.relation,
        label: outgoing ? relation.label : relation.inverse,
        note: row.note,
        other,
      },
    ];
  });
}

/**
 * Both endpoints must be editable-or-visible to the actor: linking is a write
 * on the `from` entry, so that one must be theirs, while the far end need only
 * be something they can see.
 *
 * Returns `null` when either end is missing or out of reach — the same answer
 * for both, so a link attempt cannot be used to probe for ids.
 */
export async function addLink(
  fromEntryId: string,
  toEntryId: string,
  relation: string,
  viewer: Viewer,
  note?: string | null,
): Promise<PlaceLink[] | null> {
  if (!isRelation(relation)) invalid('That is not a kind of link');
  if (fromEntryId === toEntryId) invalid('An entry cannot link to itself');

  const from = await getSummaryById(fromEntryId, viewer);
  if (!from || !canEdit(from, viewer)) return null;

  const to = await getSummaryById(toEntryId, viewer);
  if (!to) return null;

  await getDb()
    .insert(entryLink)
    .values({
      id: crypto.randomUUID(),
      fromEntryId,
      toEntryId,
      relation,
      note: trimmedOrNull(note, NOTE_MAX_LENGTH, 'Link note'),
    })
    .onConflictDoNothing();

  return linksFor(fromEntryId, viewer);
}

/** Removable from either end, but only by the owner of the entry asked about. */
export async function removeLink(
  entryId: string,
  linkId: string,
  viewer: Viewer,
): Promise<PlaceLink[] | null> {
  const place = await getSummaryById(entryId, viewer);
  if (!place || !canEdit(place, viewer)) return null;

  await getDb()
    .delete(entryLink)
    .where(
      and(
        eq(entryLink.id, linkId),
        or(eq(entryLink.fromEntryId, entryId), eq(entryLink.toEntryId, entryId)),
      ),
    );

  return linksFor(entryId, viewer);
}

/* ------------------------------------------------------------------ visits */

/** A visit belongs to the person who made it, so anyone who can see an entry
 * may record one on it — including on somebody else's public entry. */
export async function addVisit(
  entryId: string,
  viewer: Viewer,
  visitedOn: string,
  note?: string | null,
): Promise<PlaceVisit[] | null> {
  if (!viewer?.id) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitedOn)) {
    invalid('A visit needs a date, as YYYY-MM-DD');
  }

  const place = await getSummaryById(entryId, viewer);
  if (!place) return null;

  await getDb()
    .insert(entryVisit)
    .values({
      id: crypto.randomUUID(),
      entryId,
      userId: viewer.id,
      visitedOn,
      note: trimmedOrNull(note, NOTE_MAX_LENGTH, 'Visit note'),
    })
    .onConflictDoNothing();

  return visitsFor(entryId, viewer);
}

export async function removeVisit(
  entryId: string,
  visitId: string,
  viewer: Viewer,
): Promise<PlaceVisit[] | null> {
  if (!viewer?.id) return null;

  const place = await getSummaryById(entryId, viewer);
  if (!place) return null;

  // Scoped to the visitor's own row: a visit is theirs, not the entry owner's.
  await getDb()
    .delete(entryVisit)
    .where(
      and(
        eq(entryVisit.id, visitId),
        eq(entryVisit.entryId, entryId),
        eq(entryVisit.userId, viewer.id),
      ),
    );

  return visitsFor(entryId, viewer);
}

/**
 * A visitor sees their own visits and nobody else's, even on an entry somebody
 * else made public. A visit note is a diary line — "kids melted down at the
 * top" is written for the person who wrote it, and publishing an entry should
 * not publish the dates and moods of everyone who has since been there.
 *
 * Households widen this to the household's rows; starting narrow is the
 * direction that cannot leak, since data shown once cannot be unshown.
 *
 * A signed-out visitor has no visits, so this answers with none rather than
 * with everyone's.
 */
function visitsFor(entryId: string, viewer: Viewer): Promise<PlaceVisit[]> {
  if (!viewer?.id) return Promise.resolve([]);

  return getDb()
    .select({
      id: entryVisit.id,
      visitedOn: entryVisit.visitedOn,
      note: entryVisit.note,
    })
    .from(entryVisit)
    .where(
      and(eq(entryVisit.entryId, entryId), eq(entryVisit.userId, viewer.id)),
    )
    .orderBy(desc(entryVisit.visitedOn));
}

/* ------------------------------------------------------------------- types */

export async function listTypes(kind?: 'location' | 'activity') {
  const rows = await getDb()
    .select({
      id: entryType.id,
      kind: entryType.kind,
      slug: entryType.slug,
      label: entryType.label,
      icon: entryType.icon,
      colour: entryType.colour,
      position: entryType.position,
    })
    .from(entryType)
    .where(
      kind
        ? and(eq(entryType.isActive, true), eq(entryType.kind, kind))
        : eq(entryType.isActive, true),
    )
    .orderBy(asc(entryType.kind), asc(entryType.position), asc(entryType.label));

  return rows;
}

/* -------------------------------------------------------------- validation */

function trimmedOrNull(
  value: string | null | undefined,
  max: number,
  label: string,
): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    invalid(`${label} must be ${max} characters or fewer`);
  }
  return trimmed;
}

type NormalisedInput = {
  kind: Kind;
  name: string;
  description: string | null;
  lat: number | null;
  lng: number | null;
  extent: Extent;
  bboxMinLat: number | null;
  bboxMinLng: number | null;
  bboxMaxLat: number | null;
  bboxMaxLng: number | null;
  seasons: number;
  access: string | null;
  mapsUrl: string | null;
  location: {
    typeId: string;
    attributes: string | null;
  } | null;
  activity: {
    typeId: string;
    difficulty: Difficulty | null;
    durationBucket: DurationBucket | null;
    durationMinutes: number | null;
    familyFriendly: boolean | null;
    distanceM: number | null;
    ascentM: number | null;
    attributes: string | null;
  } | null;
  photos: { url: string; caption: string | null }[];
};

function positiveOrNull(
  value: number | null | undefined,
  label: string,
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) invalid(`${label} cannot be negative`);
  return Math.round(value);
}

/**
 * Scheme-checked like a photo link, and for a sharper reason: this one is
 * rendered as an `href`, so `javascript:` would be a stored XSS on an entry
 * its owner is allowed to make public. The host is deliberately not checked —
 * Apple Maps, OsmAnd and Organic Maps are all legitimate answers.
 */
function mapsUrl(value: string | null | undefined): string | null {
  const url = value?.trim();
  if (!url) return null;
  if (url.length > URL_MAX_LENGTH) invalid('That map link is too long');
  if (!/^https?:\/\//i.test(url)) {
    invalid('A map link must start with http:// or https://');
  }

  return url;
}

export function normaliseInput(input: PlaceInput): NormalisedInput {
  const name = input.name?.trim() ?? '';
  if (!name) invalid('This needs a name');
  if (name.length > NAME_MAX_LENGTH) {
    invalid(`Name must be ${NAME_MAX_LENGTH} characters or fewer`);
  }

  // The kind is not chosen, it is a consequence of what was filled in.
  if (!input.location && !input.activity) {
    invalid('Say whether this is a place, a thing to do, or both');
  }
  const kind: Kind =
    input.location && input.activity
      ? 'both'
      : input.location
        ? 'location'
        : 'activity';

  const extent = input.extent ?? 'point';
  if (!EXTENTS.includes(extent)) invalid('That is not a kind of extent');

  const lat = input.lat ?? null;
  const lng = input.lng ?? null;
  if ((lat === null) !== (lng === null)) {
    invalid('Coordinates need both a latitude and a longitude');
  }
  if (lat !== null && !isValidLatitude(lat)) invalid('Latitude is out of range');
  if (lng !== null && !isValidLongitude(lng)) invalid('Longitude is out of range');

  const bbox = input.bbox ?? null;
  if (bbox) {
    const { minLat, minLng, maxLat, maxLng } = bbox;
    if (
      !isValidLatitude(minLat) ||
      !isValidLatitude(maxLat) ||
      !isValidLongitude(minLng) ||
      !isValidLongitude(maxLng)
    ) {
      invalid('The bounding box is out of range');
    }
    if (minLat > maxLat || minLng > maxLng) {
      invalid('The bounding box is inside out');
    }
  }

  const seasons = input.seasons ?? 0;
  if (!Number.isInteger(seasons) || seasons < 0 || seasons > ALL_SEASONS) {
    invalid('That is not a set of seasons');
  }

  const photos = (input.photos ?? [])
    .map((photo) => ({
      url: photo.url?.trim() ?? '',
      caption: trimmedOrNull(photo.caption, CAPTION_MAX_LENGTH, 'Photo caption'),
    }))
    .filter((photo) => photo.url.length > 0);

  if (photos.length > MAX_PHOTOS) {
    invalid(`At most ${MAX_PHOTOS} photos`);
  }
  for (const photo of photos) {
    if (photo.url.length > URL_MAX_LENGTH) invalid('That photo link is too long');
    if (!/^https?:\/\//i.test(photo.url)) {
      invalid('Photo links must start with http:// or https://');
    }
  }

  let activity: NormalisedInput['activity'] = null;
  if (input.activity) {
    const { difficulty, durationMinutes } = input.activity;
    if (difficulty && !DIFFICULTIES.includes(difficulty)) {
      invalid('That is not a difficulty');
    }

    const minutes = positiveOrNull(durationMinutes, 'Duration');
    // Minutes win when both are given, so the two can never disagree.
    const bucket = minutes !== null
      ? bucketForMinutes(minutes)
      : (input.activity.durationBucket ?? null);
    if (bucket && !DURATION_BUCKETS.includes(bucket)) {
      invalid('That is not a duration');
    }

    activity = {
      typeId: input.activity.typeId,
      difficulty: difficulty ?? null,
      durationBucket: bucket,
      durationMinutes: minutes,
      familyFriendly: input.activity.familyFriendly ?? null,
      distanceM: positiveOrNull(input.activity.distanceM, 'Distance'),
      ascentM: positiveOrNull(input.activity.ascentM, 'Ascent'),
      attributes: serialiseAttributes(input.activity.attributes),
    };
    if (!activity.typeId) invalid('Choose a type for the activity');
  }

  if (input.location && !input.location.typeId) {
    invalid('Choose a type for the place');
  }

  return {
    kind,
    name,
    description: trimmedOrNull(
      input.description,
      DESCRIPTION_MAX_LENGTH,
      'Description',
    ),
    lat,
    lng,
    extent,
    bboxMinLat: bbox?.minLat ?? null,
    bboxMinLng: bbox?.minLng ?? null,
    bboxMaxLat: bbox?.maxLat ?? null,
    bboxMaxLng: bbox?.maxLng ?? null,
    seasons,
    access: trimmedOrNull(input.access, ACCESS_MAX_LENGTH, 'Access'),
    mapsUrl: mapsUrl(input.mapsUrl),
    location: input.location
      ? {
          typeId: input.location.typeId,
          attributes: serialiseAttributes(input.location.attributes),
        }
      : null,
    activity,
    photos,
  };
}

/**
 * Types are scoped by kind structurally — a location's type lives in the
 * location table — but nothing stops a caller passing an activity type id, so
 * it is checked once here rather than trusted.
 */
async function assertTypes(normalised: NormalisedInput) {
  const wanted: (readonly [string, 'location' | 'activity'])[] = [];
  if (normalised.location) wanted.push([normalised.location.typeId, 'location']);
  if (normalised.activity) wanted.push([normalised.activity.typeId, 'activity']);

  if (wanted.length === 0) return;

  const rows = await getDb()
    .select({ id: entryType.id, kind: entryType.kind, isActive: entryType.isActive })
    .from(entryType)
    .where(inArray(entryType.id, wanted.map(([id]) => id)));

  for (const [id, kind] of wanted) {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row || row.kind !== kind || !row.isActive) {
      invalid(`That is not a ${kind === 'location' ? 'place' : 'activity'} type`);
    }
  }
}

/**
 * Slugs are unique, so a second "Lake" gets a suffix. The loop is bounded and
 * falls back to a random suffix, since a race between two saves of the same
 * name would otherwise fail the insert.
 */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);

  const existing = await getDb()
    .select({ slug: entry.slug })
    .from(entry)
    .where(
      or(eq(entry.slug, base), sql`${entry.slug} like ${`${base}-%`}`),
    );
  const taken = new Set(existing.map((row) => row.slug));

  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

/* ------------------------------------------------------------------ writes */

function detailRows(id: string, normalised: NormalisedInput) {
  const db = getDb();
  const statements = [];

  if (normalised.location) {
    statements.push(
      db.insert(locationDetail).values({ entryId: id, ...normalised.location }),
    );
  }
  if (normalised.activity) {
    statements.push(
      db.insert(activityDetail).values({ entryId: id, ...normalised.activity }),
    );
  }
  if (normalised.photos.length) {
    statements.push(
      db.insert(entryPhoto).values(
        normalised.photos.map((photo, position) => ({
          id: crypto.randomUUID(),
          entryId: id,
          url: photo.url,
          caption: photo.caption,
          position,
        })),
      ),
    );
  }

  return statements;
}

export async function create(
  viewer: Viewer,
  input: PlaceInput,
): Promise<{ id: string; slug: string }> {
  if (!viewer?.id) invalid('Sign in to add a place');

  const normalised = normaliseInput(input);
  await assertTypes(normalised);

  const id = crypto.randomUUID();
  const slug = await uniqueSlug(normalised.name);
  const db = getDb();

  const insertEntry = db.insert(entry).values({
    id,
    slug,
    kind: normalised.kind,
    name: normalised.name,
    description: normalised.description,
    userId: viewer.id,
    visibility: visibilityFor(viewer, input.visibility),
    lat: normalised.lat,
    lng: normalised.lng,
    extent: normalised.extent,
    bboxMinLat: normalised.bboxMinLat,
    bboxMinLng: normalised.bboxMinLng,
    bboxMaxLat: normalised.bboxMaxLat,
    bboxMaxLng: normalised.bboxMaxLng,
    seasons: normalised.seasons,
    access: normalised.access,
    mapsUrl: normalised.mapsUrl,
  });

  // D1 has no interactive transactions; `batch` is the atomic equivalent.
  const rest = detailRows(id, normalised);
  if (rest.length) {
    await db.batch([insertEntry, ...rest] as [typeof insertEntry, ...typeof rest]);
  } else {
    await insertEntry;
  }

  return { id, slug };
}

/**
 * Replaces the whole entry — details and photos included — matching an editor
 * that submits the full thing. The slug is deliberately not recomputed.
 *
 * Returns `false` when the entry is missing or not the viewer's, which are
 * indistinguishable from outside.
 */
export async function update(
  id: string,
  viewer: Viewer,
  input: PlaceInput,
): Promise<boolean> {
  const normalised = normaliseInput(input);
  await assertTypes(normalised);

  const db = getDb();
  const [existing] = await db
    .select({ id: entry.id, userId: entry.userId, visibility: entry.visibility })
    .from(entry)
    .where(eq(entry.id, id))
    .limit(1);

  if (!existing || !canEdit(existing, viewer)) return false;

  const statements = [
    db
      .update(entry)
      .set({
        kind: normalised.kind,
        name: normalised.name,
        description: normalised.description,
        visibility: isAdmin(viewer)
          ? visibilityFor(viewer, input.visibility)
          : // A normal user's entry stays as it is: they cannot publish, and a
            // silent revert would be just as surprising as an escalation.
            (existing.visibility as Visibility),
        lat: normalised.lat,
        lng: normalised.lng,
        extent: normalised.extent,
        bboxMinLat: normalised.bboxMinLat,
        bboxMinLng: normalised.bboxMinLng,
        bboxMaxLat: normalised.bboxMaxLat,
        bboxMaxLng: normalised.bboxMaxLng,
        seasons: normalised.seasons,
        access: normalised.access,
        mapsUrl: normalised.mapsUrl,
        updatedAt: new Date(),
      })
      .where(eq(entry.id, id)),
    db.delete(locationDetail).where(eq(locationDetail.entryId, id)),
    db.delete(activityDetail).where(eq(activityDetail.entryId, id)),
    db.delete(entryPhoto).where(eq(entryPhoto.entryId, id)),
    ...detailRows(id, normalised),
  ];

  await db.batch(statements as [(typeof statements)[number], ...typeof statements]);

  return true;
}

/** Returns `false` when the entry is missing or not the viewer's. */
export async function remove(id: string, viewer: Viewer): Promise<boolean> {
  if (!viewer?.id) return false;

  const result = await getDb()
    .delete(entry)
    .where(and(eq(entry.id, id), eq(entry.userId, viewer.id)))
    .returning({ id: entry.id });

  return result.length > 0;
}

/** Admin-only, and only over their own entries — see `canEdit`. */
export async function setVisibility(
  id: string,
  viewer: Viewer,
  visibility: Visibility,
): Promise<boolean> {
  if (!isAdmin(viewer)) return false;

  const result = await getDb()
    .update(entry)
    .set({ visibility, updatedAt: new Date() })
    .where(and(eq(entry.id, id), eq(entry.userId, viewer!.id)))
    .returning({ id: entry.id });

  return result.length > 0;
}
