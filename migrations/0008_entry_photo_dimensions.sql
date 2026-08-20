-- The shape of a photo, so the page stops jumping while it loads.
--
-- No `<img>` in the places UI carries `width` or `height`, so the browser
-- reserves no height until the bytes arrive and everything below a photo moves
-- down as each one decodes. A fixed `aspect-[3/2]` box would fix that and was
-- rejected on purpose: a panorama and a portrait should not be cropped to the
-- same rectangle. Keeping the natural shape is exactly why CSS alone cannot
-- reserve the box — nothing on the page knows the shape until it loads — so
-- the shape has to be stored.
--
-- Given the pair, browsers derive `aspect-ratio` even under a `width: 100%`
-- rule, so the correctly shaped box exists before the image does. It also
-- unlocks `<Image>` from `astro:assets`, which refuses remote images without
-- dimensions.
--
-- Measured in the editor with `new Image()` on the pasted URL, rather than in
-- the Worker: the file is remote, so the server would have to fetch it, and
-- the browser is about to load it anyway. That is also why both columns are
-- nullable and neither is checked for consistency with the file — a URL that
-- fails to load, a photo added before this migration, or a row written by the
-- API directly all store nulls and render exactly as they did before. The
-- fallback is the old behaviour, not an error.

ALTER TABLE `entry_photo` ADD COLUMN `width` integer;
ALTER TABLE `entry_photo` ADD COLUMN `height` integer;
