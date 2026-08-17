-- The starting vocabulary of types. Written by hand rather than generated,
-- because drizzle-kit diffs schema and not data.
--
-- Ids are readable and deterministic (`loc_lake`, `act_hike`) so that a seeded
-- type can be referred to from a test or a fixture without a lookup, and so
-- re-running this file is an obvious no-op. Adding a type later is one INSERT
-- here or, until there is an admin UI, one `wrangler d1 execute`.

INSERT OR IGNORE INTO entry_type (id, kind, slug, label, icon, colour, position) VALUES
  ('loc_lake',        'location', 'lake',              'Lake',              '🏞️', '#2563eb', 10),
  ('loc_viewpoint',   'location', 'viewpoint',         'Viewpoint',         '👁️', '#7c3aed', 20),
  ('loc_car_park',    'location', 'car-park',          'Car park',          '🅿️', '#64748b', 30),
  ('loc_refuge',      'location', 'refuge',            'Refuge',            '🛖', '#b45309', 40),
  ('loc_beach',       'location', 'beach',             'Beach',             '🏖️', '#f59e0b', 50),
  ('loc_wild_camp',   'location', 'wild-camping-spot', 'Wild camping spot', '⛺', '#15803d', 60),
  ('loc_campsite',    'location', 'campsite',          'Campsite',          '🏕️', '#16a34a', 70),
  ('loc_town',        'location', 'town',              'Town',              '🏘️', '#78716c', 80),
  ('loc_region',      'location', 'region',            'Region',            '🗺️', '#0f766e', 90),
  ('loc_cave',        'location', 'cave',              'Cave',              '🕳️', '#44403c', 100),
  ('loc_peak',        'location', 'mountain-peak',     'Mountain peak',     '⛰️', '#57534e', 110),
  ('loc_restaurant',  'location', 'restaurant',        'Restaurant',        '🍽️', '#dc2626', 120);

INSERT OR IGNORE INTO entry_type (id, kind, slug, label, icon, colour, position) VALUES
  ('act_hike',        'activity', 'hike',              'Hike',              '🥾', '#166534', 10),
  ('act_via_ferrata', 'activity', 'via-ferrata',       'Via ferrata',       '🧗', '#ea580c', 20),
  ('act_climbing',    'activity', 'climbing',          'Climbing',          '🪨', '#9a3412', 30),
  ('act_kayaking',    'activity', 'kayaking',          'Kayaking',          '🛶', '#0284c7', 40),
  ('act_cycling',     'activity', 'cycling',           'Cycling',           '🚲', '#4d7c0f', 50),
  ('act_wild_swim',   'activity', 'wild-swimming',     'Wild swimming',     '🏊', '#0891b2', 60),
  ('act_sup',         'activity', 'sup',               'Paddleboarding',    '🏄', '#0d9488', 70);
