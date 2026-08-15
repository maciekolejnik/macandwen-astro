# Astro features not yet used here

A survey of what Astro offers that this site does not currently use, and whether
it is worth adopting. Nothing here is a commitment — it is a shortlist to pull
from when the need appears.

Currently in use: `.astro` components, file-based and dynamic routing,
`getStaticPaths`, per-route `prerender = false`, API endpoints, the content
layer (`glob` loader + Zod), middleware with typed `App.Locals`, bundled
`<script>` blocks, and the Cloudflare adapter.

## Priority: `astro:assets` and `<Image>`

Every image on the site is a plain `<img>` pointing at
`https://media.macandwen.com/...` — the hero, the post cards, and everything
inside Markdown bodies. This is the largest single gap. `<Image>` and
`<Picture>` give lazy loading, `width`/`height` (so no layout shift), automatic
`srcset`/`sizes`, and modern formats (AVIF/WebP) with fallbacks.

**The catch:** the default image service is sharp, which cannot run on
Cloudflare Workers. `@astrojs/cloudflare` accepts an `imageService` option, so
the choice has to be made deliberately:

| `imageService` | What it does | Fit here |
| --- | --- | --- |
| `'compile'` | Optimises local images at build time; remote images pass through untouched | Good if images move into `src/` |
| `'cloudflare'` | Uses Cloudflare's Image Resizing at request time | Best for remote images, but a paid Cloudflare feature |
| `'passthrough'` | No optimisation; `<Image>` still emits dimensions and `srcset` markup | Zero-cost first step |
| `'custom'` | Point at another endpoint (e.g. Cloudflare Images, imgix) | If the media host gains a resize API |

Because the images are remote, `image.domains` or `image.remotePatterns` must
list `media.macandwen.com` before `<Image>` will accept those URLs.

A sensible sequence:

1. Add `image.domains: ['media.macandwen.com']` and switch the card and hero
   `<img>` tags to `<Image>` with explicit `width`/`height` and
   `loading="eager"` + `fetchpriority="high"` on the hero only. Even on
   `passthrough` this removes layout shift and centralises the markup.
2. Move a handful of images (favicon, any site chrome, an `og:image` default)
   into `src/assets/` so `'compile'` can actually optimise them, and get
   content-hashed filenames for free.
3. If image weight is still the bottleneck, enable `imageService: 'cloudflare'`
   and let Cloudflare resize the remote media on the fly.

Two related pieces come almost free once this is in place:

- **`image()` in the content schema.** `featured_image` and `small_image` are
  validated as `z.url()`. If images ever live alongside the Markdown, the
  `image()` helper from `astro:content` validates and processes them into
  `ImageMetadata`, so `<Image>` gets real dimensions rather than guesses.
- **`<Picture>`** for the hero, to serve AVIF with a JPEG fallback and
  art-direct a taller crop on mobile.

## View Transitions (`<ClientRouter />`)

Dropping `<ClientRouter />` into `Layout.astro` turns full-page loads into
cross-fades and enables shared-element morphs. The obvious win is the post
card image on `/blog` morphing into the hero on `/blog/[slug]` via matching
`transition:name` attributes — a striking effect for a travel blog, for roughly
five lines of markup.

Caveats worth knowing before adopting it: the client router adds ~10 kB of JS to
every page, `<script>` blocks need to be re-run per navigation (or use
`transition:persist`), and the `AuthNav` session lookup would fire on each
navigation unless the result is cached.

## Server Islands

`AuthNav.astro` currently renders "Sign in" statically and upgrades itself with
a client-side `getSession()` call. A server island (`<AuthNav server:defer />`)
would let the nav render on the server with the real session, streamed in after
the static shell, keeping the page prerendered and cacheable while removing the
flash of the wrong state. This is the idiomatic Astro answer to exactly the
problem the current comment in `AuthNav.astro` describes.

Trade-off: it costs a Worker request per page view, whereas the current approach
costs one client fetch. Worth measuring before switching.

## Astro Actions

Account deletion and sign-out are hand-written `fetch` calls in a `<script>`.
Actions give typed, Zod-validated server functions callable from the client with
`actions.deleteAccount(...)`, automatic error shapes, and progressive
enhancement via form submission. If the site grows any real forms — a comment
box, a trip-planner, a contact form — this is the mechanism to reach for rather
than adding more ad-hoc endpoints. `defineAction` also runs through the same
middleware, so `locals.user` is available without extra plumbing.

## Framework islands (`client:*`)

Deliberately absent, and that is the right default. Only introduce React/Svelte
/Solid for genuinely stateful UI — an image lightbox or a map for trip routes
are the plausible candidates. Even then, prefer a vanilla `<script>` first;
`client:visible` on a single island beats adopting a framework site-wide.

## Smaller wins

| Feature | Use here |
| --- | --- |
| `@astrojs/sitemap` | Auto-generated `sitemap-index.xml`; requires setting `site` in the config, which is currently unset (`Layout.astro` falls back to `Astro.url.origin` for canonicals) |
| `@astrojs/rss` | An `/rss.xml` endpoint built from `getCollection('blog')` — a dozen lines |
| `@astrojs/mdx` | Only if posts need embedded components (maps, galleries, callouts); plain Markdown is fine today |
| Content collection `references()` | Model authors, tags, or destinations as their own collection and relate posts to them |
| `getStaticPaths` pagination (`paginate()`) | `/blog` renders every post on one page; paginate once the archive gets long |
| `astro:env` | Typed, validated env schema for `GOOGLE_CLIENT_ID` etc., replacing the hand-written `Cloudflare.Env` declaration in `env.d.ts` |
| `Astro.rewrite()` | Serve a different route without a redirect — useful for legacy blog URLs |
| Custom 404 / 500 pages | `src/pages/404.astro` is missing; Cloudflare currently serves a bare default |
| `<Font />` (experimental fonts API) | Self-host and preload fonts with automatic fallback metrics |
| Prefetch (`prefetch: true`) | Preload post pages on link hover; pairs naturally with view transitions |
| Markdown `remark`/`rehype` plugins | Auto-linked headings, reading time, external-link `rel` attributes |

## Suggested order

1. `<Image>` with `image.domains` and `passthrough` — biggest user-visible win,
   no new cost.
2. `@astrojs/rss` and `@astrojs/sitemap`, plus setting `site`.
3. A `404.astro`.
4. View transitions with shared-element morphs on post images.
5. Revisit `imageService: 'cloudflare'` and server islands once there is real
   traffic data.
