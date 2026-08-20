/**
 * What a map needs from an entry, and nothing else.
 *
 * The map page renders its pins into the HTML server-side and Leaflet reads
 * them from there, so a shared link never flashes an empty map and the list
 * and the map can never show different sets. That means the pin has to be a
 * plain, serialisable shape rather than a `PlaceSummary` with its Dates and
 * its detail rows — and building it is a decision (which type colours the pin,
 * what the popup says, which entries are mappable at all) rather than a
 * transcription, so it lives here where a test can reach it.
 *
 * This module is imported by the browser as well as the server, so it may hold
 * types from the data layer but never values from it — one `import` of Drizzle
 * or of the D1 binding and the map script stops building. That is the same
 * rule `places-constants.ts` lives under.
 */

import type { PlaceSummary, PlaceTypeRef } from './db/places';

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
export function pinType(place: {
  location: { type: PlaceTypeRef } | null;
  activity: { type: PlaceTypeRef } | null;
}): PlaceTypeRef | null {
  return place.activity?.type ?? place.location?.type ?? null;
}

export type MapBounds = {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
};

export type MapPin = {
  id: string;
  name: string;
  href: string;
  lat: number;
  lng: number;
  /** The colour of the winning type, or a stone grey when it has none. */
  colour: string;
  /** An emoji, or null: most types honestly have none. */
  icon: string | null;
  /** The winning type's label, or null for an entry with no type at all. */
  typeLabel: string | null;
  /** Drawn as a rectangle beside the pin, for an area or a region. */
  bbox: MapBounds | null;
  /** The picture the popup shows, when there is one. */
  photoUrl: string | null;
  /** Marks the entry a detail page is about, so its own pin can stand out. */
  focus: boolean;
};

/** Used when a type carries no colour, matching the badge fallback. */
export const FALLBACK_COLOUR = '#57534e';

/**
 * Roughly the eastern Pyrenees, which is where this database starts. Only ever
 * used when there is nothing at all to fit the view to — one pin is enough to
 * make the map decide for itself.
 */
export const DEFAULT_CENTRE = { lat: 42.2, lng: 2.1 };
export const DEFAULT_ZOOM = 7;

/** A pin needs a point. A bounding box without one is not enough: the centre
 * of a region is rarely the place you would point at, and inventing a pin
 * there would say something the owner did not. */
export function isMappable(place: {
  lat: number | null;
  lng: number | null;
}): boolean {
  return place.lat !== null && place.lng !== null;
}

export function toPin(place: PlaceSummary, focusId?: string): MapPin {
  const type = pinType(place);

  return {
    id: place.id,
    name: place.name,
    href: `/places/${place.slug}`,
    lat: place.lat!,
    lng: place.lng!,
    colour: type?.colour ?? FALLBACK_COLOUR,
    icon: type?.icon ?? null,
    typeLabel: type?.label ?? null,
    bbox: place.extent === 'point' ? null : place.bbox,
    photoUrl: place.photoUrl,
    focus: place.id === focusId,
  };
}

/**
 * Entries without coordinates are dropped rather than pinned somewhere
 * plausible — a wrong pin is worse than a missing one. The map page says how
 * many it left out, which is what `countUnmapped` is for.
 */
export function toPins(places: PlaceSummary[], focusId?: string): MapPin[] {
  return places.filter(isMappable).map((place) => toPin(place, focusId));
}

export function countUnmapped(places: PlaceSummary[]): number {
  return places.filter((place) => !isMappable(place)).length;
}

/**
 * The rectangle the view should open on: every pin, and every bounding box,
 * inside it. Null when there is nothing to show, which is the only case where
 * a default centre is needed.
 */
export function boundsOf(pins: MapPin[]): MapBounds | null {
  if (pins.length === 0) return null;

  const bounds: MapBounds = {
    minLat: 90,
    minLng: 180,
    maxLat: -90,
    maxLng: -180,
  };

  for (const pin of pins) {
    const corners = pin.bbox
      ? [
          { lat: pin.lat, lng: pin.lng },
          { lat: pin.bbox.minLat, lng: pin.bbox.minLng },
          { lat: pin.bbox.maxLat, lng: pin.bbox.maxLng },
        ]
      : [{ lat: pin.lat, lng: pin.lng }];

    for (const corner of corners) {
      bounds.minLat = Math.min(bounds.minLat, corner.lat);
      bounds.minLng = Math.min(bounds.minLng, corner.lng);
      bounds.maxLat = Math.max(bounds.maxLat, corner.lat);
      bounds.maxLng = Math.max(bounds.maxLng, corner.lng);
    }
  }

  return bounds;
}

/** Corners in whichever order they were dragged, normalised to min and max.
 * Rounded to five decimals — about a metre, and far finer than the edge of a
 * valley is actually known — so the stored box does not carry a precision the
 * click did not have. */
export function normaliseBounds(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): MapBounds {
  const round = (value: number) => Number(value.toFixed(5));

  return {
    minLat: round(Math.min(a.lat, b.lat)),
    minLng: round(Math.min(a.lng, b.lng)),
    maxLat: round(Math.max(a.lat, b.lat)),
    maxLng: round(Math.max(a.lng, b.lng)),
  };
}

/**
 * The whole payload a rendered map carries, so the page writes one JSON blob
 * and the browser reads one shape.
 */
export type MapData = {
  pins: MapPin[];
  bounds: MapBounds | null;
  /** Lets the owner drop and drag a pin, and drag a box for an area. */
  picker: boolean;
};
