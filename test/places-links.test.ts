import { describe, expect, it } from 'vitest';
import {
  addLink,
  create,
  getById,
  linksFor,
  remove,
  removeLink,
  PlacesValidationError,
} from '../src/lib/db/places';
import { signedInUser } from './helpers';

const LAKE = 'loc_lake';
const CAR_PARK = 'loc_car_park';
const HIKE = 'act_hike';

async function aHikeAndACarPark(owner: Awaited<ReturnType<typeof signedInUser>>) {
  const hike = await create(owner, {
    name: 'Ridge walk',
    activity: { typeId: HIKE },
  });
  const carPark = await create(owner, {
    name: 'Trailhead parking',
    location: { typeId: CAR_PARK },
  });

  return { hike, carPark };
}

describe('links', () => {
  it('reads an asymmetric link differently from each end', async () => {
    const owner = await signedInUser();
    const { hike, carPark } = await aHikeAndACarPark(owner);

    await addLink(hike.id, carPark.id, 'parks_at', owner);

    const [fromHike] = await linksFor(hike.id, owner);
    const [fromCarPark] = await linksFor(carPark.id, owner);

    expect(fromHike?.label).toBe('Park at');
    expect(fromHike?.other.name).toBe('Trailhead parking');
    // One row, two readings — rather than two rows that could disagree.
    expect(fromCarPark?.label).toBe('Parking for');
    expect(fromCarPark?.other.name).toBe('Ridge walk');
    expect(fromCarPark?.id).toBe(fromHike?.id);
  });

  it('reads a symmetric link the same way from both ends', async () => {
    const owner = await signedInUser();
    const { hike, carPark } = await aHikeAndACarPark(owner);

    await addLink(hike.id, carPark.id, 'near', owner);

    const [fromHike] = await linksFor(hike.id, owner);
    const [fromCarPark] = await linksFor(carPark.id, owner);

    expect(fromHike?.label).toBe('Near');
    expect(fromCarPark?.label).toBe('Near');
  });

  it('carries the shape of the brief: a hike, its parking, a refuge and a swim', async () => {
    const owner = await signedInUser();
    const hike = await create(owner, { name: 'Circuit', activity: { typeId: HIKE } });
    const carPark = await create(owner, {
      name: 'Parking',
      location: { typeId: CAR_PARK },
    });
    const refuge = await create(owner, { name: 'Refuge', location: { typeId: LAKE } });
    // The swim is the lake: one hybrid row rather than two that duplicate it.
    const swim = await create(owner, {
      name: 'Lake',
      location: { typeId: LAKE },
      activity: { typeId: HIKE },
    });

    await addLink(hike.id, carPark.id, 'parks_at', owner);
    await addLink(hike.id, refuge.id, 'passes_through', owner);
    await addLink(hike.id, swim.id, 'passes_through', owner);

    const links = await linksFor(hike.id, owner);

    expect(links).toHaveLength(3);
    expect(links.map((link) => link.other.name)).toEqual([
      'Parking',
      'Refuge',
      'Lake',
    ]);
    expect((await getById(swim.id, owner))?.kind).toBe('both');
  });

  it('is idempotent for the same pair and relation', async () => {
    const owner = await signedInUser();
    const { hike, carPark } = await aHikeAndACarPark(owner);

    await addLink(hike.id, carPark.id, 'parks_at', owner);
    const links = await addLink(hike.id, carPark.id, 'parks_at', owner);

    expect(links).toHaveLength(1);
  });

  it('allows two different relations between the same pair', async () => {
    const owner = await signedInUser();
    const { hike, carPark } = await aHikeAndACarPark(owner);

    await addLink(hike.id, carPark.id, 'parks_at', owner);
    const links = await addLink(hike.id, carPark.id, 'starts_at', owner);

    expect(links).toHaveLength(2);
  });

  it('refuses a relation outside the vocabulary, and a self-link', async () => {
    const owner = await signedInUser();
    const { hike, carPark } = await aHikeAndACarPark(owner);

    await expect(
      addLink(hike.id, carPark.id, 'parking', owner),
    ).rejects.toThrow(PlacesValidationError);
    await expect(addLink(hike.id, hike.id, 'near', owner)).rejects.toThrow(
      PlacesValidationError,
    );
  });

  it('lets only the owner of the near end link, and only to what they can see', async () => {
    const owner = await signedInUser();
    const other = await signedInUser();
    const { hike, carPark } = await aHikeAndACarPark(owner);
    const theirs = await create(other, {
      name: 'Their private lake',
      location: { typeId: LAKE },
    });

    // Not their entry to link from.
    expect(await addLink(hike.id, carPark.id, 'parks_at', other)).toBeNull();
    // Their entry, but the far end is invisible — the same answer as missing.
    expect(await addLink(hike.id, theirs.id, 'near', owner)).toBeNull();
    expect(
      await addLink(hike.id, crypto.randomUUID(), 'near', owner),
    ).toBeNull();
  });

  it('hides a link whose far end the viewer cannot see', async () => {
    const admin = await signedInUser({ role: 'admin' });
    const stranger = await signedInUser();
    const shown = await create(admin, {
      name: 'Public hike',
      activity: { typeId: HIKE },
      visibility: 'public',
    });
    const hidden = await create(admin, {
      name: 'Secret parking',
      location: { typeId: CAR_PARK },
    });

    await addLink(shown.id, hidden.id, 'parks_at', admin);

    // The owner sees the link; anyone else must not learn the private entry
    // exists, let alone what it is called.
    expect(await linksFor(shown.id, admin)).toHaveLength(1);
    expect(await linksFor(shown.id, stranger)).toHaveLength(0);
    expect(await linksFor(shown.id, undefined)).toHaveLength(0);
    expect((await getById(shown.id, stranger))?.links).toHaveLength(0);
  });

  it('lets the owner of either end remove a link', async () => {
    const owner = await signedInUser();
    const other = await signedInUser();
    const { hike, carPark } = await aHikeAndACarPark(owner);
    const [link] = (await addLink(hike.id, carPark.id, 'parks_at', owner)) ?? [];

    expect(await removeLink(carPark.id, link!.id, other)).toBeNull();
    expect(await removeLink(carPark.id, link!.id, owner)).toHaveLength(0);
    expect(await linksFor(hike.id, owner)).toHaveLength(0);
  });

  it('takes links with the entry at either end', async () => {
    const owner = await signedInUser();
    const { hike, carPark } = await aHikeAndACarPark(owner);
    await addLink(hike.id, carPark.id, 'parks_at', owner);

    await remove(carPark.id, owner);

    expect(await linksFor(hike.id, owner)).toHaveLength(0);
  });
});
