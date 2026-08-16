# Dark mode

The site follows the reader's operating system setting. There is no theme
toggle, no stored preference and no JavaScript involved.

## How it works

Tailwind's `dark:` variant compiles, by default, to a
`@media (prefers-color-scheme: dark)` block. The browser resolves that media
query itself, from the static HTML, which is what makes this approach fit the
site: most pages are prerendered and served from cache, so there is no server
render in which a per-visitor theme could be decided, and no class to set
before paint. Nothing can flash, because nothing is applied after load.

`src/styles/global.css` adds one rule:

```css
html {
  color-scheme: light dark;
}
```

That is what brings the browser's own furniture — scrollbars, the default
form-control and checkbox rendering, and the canvas behind the page — in line
with the active theme. Without it those stay light while the page goes dark.

## The palette

Light stays as it was; dark is the same hues moved down the `stone` ramp, with
`emerald` lifted so it still reads as a link against a dark background.

| Role | Light | Dark |
| --- | --- | --- |
| Page background | `stone-50` | `stone-950` |
| Card, header, footer | `white` | `stone-900` |
| Body text | `stone-800` | `stone-200` |
| Headings | `stone-900` | `stone-100` |
| Muted text | `stone-500` / `stone-400` | `stone-400` / `stone-500` |
| Borders, dividers | `stone-200` / `stone-300` | `stone-800` / `stone-700` |
| Accent | `emerald-700` | `emerald-400` |
| Destructive | `red-700` on `red-50` | `red-400` on `red-950` |

Long-form content — blog posts and the privacy page — uses the typography
plugin's `dark:prose-invert` rather than restating the palette per element.

## What deliberately has no dark variant

Anything already sitting on a dark photograph: the home hero, the blog post
hero and its gradient, and the `transparentHeader` branch of the header, whose
white-on-image styling is correct in both themes.

## Adding to it

Every colour utility needs its dark counterpart written next to it — there is
no automatic inversion. The check before opening a pull request is to grep for
colour classes with no neighbouring `dark:`, allowing for the exceptions above.

## If a toggle is ever wanted

The colour work done here is reusable as it stands. Switching from "follow the
system" to "follow the system, unless the reader says otherwise" means
redefining the variant against a class:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

and then setting that class on `<html>` from `localStorage` in a blocking
inline script in `<head>`, before first paint. That script is the whole cost of
a toggle, and the reason it is not here: it is the one part of this that a
prerendered, cached page cannot do for free.
