import { listVisible, type PlaceSummary } from './db/places';
import type { Viewer } from './db/places';
import {
  DURATION_LABELS,
  maskToSeasons,
  type Season,
} from './places-constants';

export type PlacesIndexView = {
  /** The visitor's own entries, private and public alike. */
  own: PlaceSummary[];
  /** Everything else they may see, which is everyone else's public entries. */
  browse: PlaceSummary[];
};

/**
 * Assembles what the index shows, kept out of the page so the rules about who
 * sees what can be tested without rendering anything.
 *
 * One query, split in memory: `listVisible` already applies the visibility
 * predicate, and the split is only about not showing the same entry twice on
 * one page.
 */
export async function loadIndex(viewer: Viewer): Promise<PlacesIndexView> {
  const visible = await listVisible(viewer);

  return splitSections(visible, viewer?.id);
}

export function splitSections(
  places: PlaceSummary[],
  viewerId: string | undefined,
): PlacesIndexView {
  if (!viewerId) return { own: [], browse: places };

  return {
    own: places.filter((place) => place.userId === viewerId),
    browse: places.filter((place) => place.userId !== viewerId),
  };
}

/**
 * The badges a card shows. A hybrid has two, which is the point of the model:
 * "Lake" and "Wild swimming" say more together than either alone.
 */
export function typeBadges(place: PlaceSummary) {
  return [place.location?.type, place.activity?.type].filter(
    (type) => type !== undefined,
  );
}

/**
 * The one type a map pin is drawn from. A hybrid has two, so this is a real
 * decision rather than a lookup: the activity wins, because a map is being
 * asked "what can I do here", and because the location half of a hybrid is
 * usually the less specific of the pair — "lake" against "wild swimming".
 *
 * It lives here, and is the only thing allowed to make this choice, so the pin
 * on the map page, the pin on a detail page and any future legend can never
 * disagree about what an entry is.
 */
export function pinType(place: PlaceSummary) {
  return place.activity?.type ?? place.location?.type ?? null;
}

const SEASON_LABELS: Record<Season, string> = {
  spring: 'spring',
  summer: 'summer',
  autumn: 'autumn',
  winter: 'winter',
};

/** `null` rather than "any time", so a page can leave the line out entirely. */
export function seasonLabel(mask: number): string | null {
  const seasons = maskToSeasons(mask).map((season) => SEASON_LABELS[season]);
  if (seasons.length === 0 || seasons.length === 4) return null;
  if (seasons.length === 1) return `Best in ${seasons[0]}`;

  const last = seasons.pop();

  return `Best in ${seasons.join(', ')} and ${last}`;
}

const DIFFICULTY_LABELS = {
  easy: 'Easy',
  moderate: 'Moderate',
  difficult: 'Difficult',
} as const;

export type Fact = { label: string; value: string };

/**
 * The facts worth putting on a card or at the top of a detail page, in a fixed
 * order and with the unknown ones left out — an entry that says "Difficulty:
 * unknown" is noisier than one that says nothing.
 */
export function factsFor(place: PlaceSummary): Fact[] {
  const facts: Fact[] = [];
  const activity = place.activity;

  if (activity?.difficulty) {
    facts.push({
      label: 'Difficulty',
      value: DIFFICULTY_LABELS[activity.difficulty],
    });
  }
  if (activity?.durationBucket) {
    facts.push({
      label: 'Duration',
      value: activity.durationMinutes
        ? `${DURATION_LABELS[activity.durationBucket]} (${formatMinutes(activity.durationMinutes)})`
        : DURATION_LABELS[activity.durationBucket],
    });
  }
  // Tri-state: only 'yes' and 'no' say anything, and "not marked" says nothing.
  if (activity?.familyFriendly !== null && activity?.familyFriendly !== undefined) {
    facts.push({
      label: 'With small children',
      value: activity.familyFriendly ? 'Yes' : 'No',
    });
  }
  if (activity?.distanceM) {
    facts.push({ label: 'Distance', value: formatDistance(activity.distanceM) });
  }
  if (activity?.ascentM) {
    facts.push({ label: 'Ascent', value: `${activity.ascentM} m` });
  }

  const season = seasonLabel(place.seasons);
  if (season) facts.push({ label: 'Season', value: season });

  return facts;
}

export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;

  return `${hours} h ${rest} min`;
}

export function formatDistance(metres: number): string {
  if (metres < 1000) return `${metres} m`;

  const km = metres / 1000;
  // A trailing '.0' reads like a precision the number does not have.
  return `${km % 1 === 0 ? km : km.toFixed(1)} km`;
}

/** Five decimal places is about a metre, which is as precise as a pin gets. */
export function formatCoordinates(
  lat: number | null,
  lng: number | null,
): string | null {
  if (lat === null || lng === null) return null;

  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

const EXTENT_LABELS = {
  point: null,
  area: 'An area, not a single point',
  region: 'A whole region',
} as const;

export function extentNote(place: PlaceSummary): string | null {
  return EXTENT_LABELS[place.extent];
}
