-- More of the vocabulary, and a fallback.
--
-- Two problems with the starting set, found by trying to record real places.
--
-- **`region` was doing double duty.** Asked what type the Ordesa valley is, the
-- only answer big enough was `region` — but size is what `extent` is for, and
-- `type` is meant to say what a thing *is*. Stretching `region` to cover a
-- landform would have made it mean "the big one", which is not a category you
-- can filter on or colour a pin by. So `region` narrows to what it should
-- always have meant — an administrative or named division, Catalunya or la
-- Cerdanya, the things an `inside` link points at — and the landforms get their
-- own types. A river swimming spot was previously forced to be a `lake`, and a
-- waterfall had nowhere to go at all.
--
-- **There was no way to say "none of these".** Without a fallback, somebody
-- meeting an unlisted thing either picks a wrong type — which silently
-- corrupts the pin colour and every filter built on it later, worse than no
-- answer — or gives up on the entry. `Other` makes the gap explicit and
-- recoverable: retyping later is one UPDATE, and the slug and URL do not move.
--
-- It also earns its keep as a work queue. `select * from entry join
-- location_detail ... where type_id = 'loc_other'` is exactly the list of types
-- the vocabulary is missing, which is most of what the "suggest a type" future
-- deliverable was going to be for. It sorts last and is never preselected, so
-- it stays an escape hatch rather than a default.
--
-- Icons stay honest, per 0003: there is no emoji for a waterfall, a gorge, a
-- valley or a mountain pass, and none is added. Colours are getting crowded at
-- this many types — the label is what actually disambiguates, and nothing may
-- depend on colour alone.

INSERT OR IGNORE INTO entry_type (id, kind, slug, label, icon, colour, position) VALUES
  ('loc_river',      'location', 'river',           'River',           NULL,  '#0ea5e9', 20),
  ('loc_waterfall',  'location', 'waterfall',       'Waterfall',       NULL,  '#06b6d4', 30),
  ('loc_spring',     'location', 'spring',          'Spring',          NULL,  '#0e7490', 40),
  ('loc_hot_spring', 'location', 'hot-spring',      'Hot spring',      '♨️', '#db2777', 50),
  ('loc_island',     'location', 'island',          'Island',          '🏝️', '#ca8a04', 70),
  ('loc_valley',     'location', 'valley',          'Valley',          NULL,  '#65a30d', 80),
  ('loc_gorge',      'location', 'gorge',           'Gorge',           NULL,  '#78350f', 90),
  ('loc_forest',     'location', 'forest',          'Forest',          '🌲', '#14532d', 110),
  ('loc_pass',       'location', 'mountain-pass',   'Mountain pass',   NULL,  '#475569', 130),
  ('loc_ruins',      'location', 'castle-or-ruins', 'Castle or ruins', '🏰', '#a21caf', 190),
  ('loc_ski',        'location', 'ski-area',        'Ski area',        '⛷️', '#0369a1', 200),
  ('loc_other',      'location', 'other',           'Other',           NULL,  '#71717a', 999);

INSERT OR IGNORE INTO entry_type (id, kind, slug, label, icon, colour, position) VALUES
  ('act_other',      'activity', 'other',           'Other',           NULL,  '#71717a', 999);

-- Regrouped so the dropdown reads in families — water, then land, then places
-- to stay, then the human-made — rather than in the order they happened to be
-- thought of. `position` is display only and nothing references it, so
-- renumbering is safe.
UPDATE entry_type SET position = 10  WHERE id = 'loc_lake';
UPDATE entry_type SET position = 60  WHERE id = 'loc_beach';
UPDATE entry_type SET position = 100 WHERE id = 'loc_cave';
UPDATE entry_type SET position = 120 WHERE id = 'loc_peak';
UPDATE entry_type SET position = 140 WHERE id = 'loc_viewpoint';
UPDATE entry_type SET position = 150 WHERE id = 'loc_refuge';
UPDATE entry_type SET position = 160 WHERE id = 'loc_campsite';
UPDATE entry_type SET position = 170 WHERE id = 'loc_wild_camp';
UPDATE entry_type SET position = 180 WHERE id = 'loc_restaurant';
UPDATE entry_type SET position = 210 WHERE id = 'loc_car_park';
UPDATE entry_type SET position = 220 WHERE id = 'loc_town';
UPDATE entry_type SET position = 230 WHERE id = 'loc_region';
