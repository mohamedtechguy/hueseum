# Hueseum: find art by colour

Hueseum is a web application for searching the Art Institute of Chicago's collection by **colour**. You pick a colour (with a colour picker, a hex code or a historic pigment such as ultramarine), and Hueseum shows artworks whose measured dominant colour matches it. You can open any work for its full museum label and an artist biography, hang it in your own exhibition, paint the gallery walls, and build a route card for a real visit that shows which of your works are on display today.

The whole site re-tints itself in the colour you choose.

## Pages

| Page | What it does |
| --- | --- |
| `index.html` | Home. Twelve historic pigment chips (hover to recolour the headline) and a "Colour of the day" with four live matching paintings. |
| `explore.html` | The main search form, results grid, sorting, "Show more", neighbouring colours and the artwork detail dialog. |
| `exhibition.html` | Your saved works hung in a framed gallery room. Reorder, remove, title the show, choose the wall colour, then plan a visit. |
| `about.html` | How the colour matching works, the APIs used, accessibility statement, FAQ and a feedback form. |

## APIs used (all free, no key needed)

1. **Art Institute of Chicago API** (`api.artic.edu`)
   - `GET /artworks/search`: colour search built from the form (hue range, saturation, lightness, era, type of work, public domain, keywords, page size, page number)
   - `GET /artworks/{id}`: full record for the detail dialog
   - `GET /artworks?ids=…`: live "on view" and gallery number for the route card
   - IIIF image server: the artwork images
2. **The Color API** (`thecolorapi.com`)
   - `GET /id`: a human name for the picked colour (for example "Persian Blue")
   - `GET /scheme`: neighbouring colours suggested as the next search
3. **Wikipedia REST API**
   - `GET /page/summary/{artist}`: a short artist biography in the detail dialog

## How it meets the assessment criteria

**HTML quality**
- Semantic landmarks on every page: `header`, `nav`, `main`, `section`, `article`, `aside`, `footer`, `figure`/`figcaption`, `dialog`, `details`/`summary`, `dl`, `output`
- Ordered and unordered lists, definition lists, internal anchor links, external links, a page `title` and `meta description` on every page
- Skip link, `aria-current` on the current page, `aria-live` regions for results and status messages

**CSS quality** (`css/styles.css`, one external file)
- Written **mobile first**: base styles target phones, then `min-width` media queries at 40em, 48em, 64em and 90em
- Selectors used: element, class, ID (`#colour-hex`, `#main`), descendant and child, adjacent sibling (`input:checked + .switch__track`), attribute selectors (`a[href^="http"]`, `[aria-current="page"]`, `[aria-invalid="true"]`, `[data-match="high"]`, `input[type="color"]`, `input[value="#2F3A4A"]`), pseudo-classes (`:hover`, `:focus-visible`, `:checked`, `:not()`, `:has()`, `:nth-child()`, `:empty`, `:first-child`), pseudo-elements (`::before`, `::after`, `::backdrop`, `::selection`, `::marker`, `::placeholder`)
- Custom properties (design tokens), CSS Grid and Flexbox, CSS counters, keyframe animations, a light and dark ("Lights off") theme, `prefers-reduced-motion` and print styles

**JavaScript quality**
- Animated hamburger menu (closes with Escape)
- "Lights off" dark mode toggle that remembers your choice
- Live colour syncing between the colour picker, hex field and pigment radio buttons, re-tinting the site
- Custom form validation with messages beside each field, an error summary with links, and live character counters
- `fetch` with `async`/`await`, timeouts, cancelling an older search when a new one starts, loading skeletons, error messages with a "Try again" button
- Sorting results without reloading, pagination ("Show more works"), a modal dialog, and `localStorage` for the exhibition

**HTML forms**
Colour picker, text (with a pattern), search (with a `datalist`), number, range with a live `output`, date (with min and max), select, radio groups, checkbox groups, toggle switches, textarea (with `maxlength` and counter), email, `fieldset` and `legend`, submit and reset buttons. All four forms are validated in JavaScript.

**Use of APIs**
Form data drives every API call: the search form builds the AIC query; the colour fields drive The Color API; opening a result calls the detail endpoint and Wikipedia; the visit form triggers the live on-view check.

**UI, UX and accessibility**
- Tested with axe-core: no WCAG 2.1 AA violations on any page in light or dark mode
- Text contrast is calculated in JavaScript, so labels on coloured chips are always readable
- Every control is keyboard accessible, with visible focus and labels on every field
- Body text uses Atkinson Hyperlegible, a typeface designed for low-vision readers

## Run it locally

Open `index.html` in a browser, or for the most reliable results serve the folder:

```
python -m http.server 8000
```

Then visit http://localhost:8000. An internet connection is needed for the APIs and fonts.

## Publish it (public URL)

**Option A: GitHub Pages**
1. Create a new public repository on GitHub, for example `hueseum`.
2. Upload every file and folder from this project to the repository root (Add file → Upload files).
3. Go to Settings → Pages, set Source to "Deploy from a branch", choose `main` and `/ (root)`, and save.
4. After a minute your site is live at `https://<your-username>.github.io/hueseum/`.

**Option B: Netlify Drop**
1. Go to https://app.netlify.com/drop.
2. Drag the project folder onto the page.
3. Netlify gives you a public URL straight away. Sign in to keep it.

## File structure

```
hueseum/
├── index.html
├── explore.html
├── exhibition.html
├── about.html
├── css/
│   └── styles.css
├── js/
│   ├── common.js      shared: colour maths, storage, menu, theme, form helpers
│   ├── api.js         all API calls
│   ├── home.js
│   ├── explore.js
│   ├── exhibition.js
│   └── about.js
└── images/
    ├── logo.svg
    └── favicon.svg
```

## Credits

Artwork data and images: Art Institute of Chicago (CC0 for data, images under the museum's terms). Colour names: The Color API. Artist biographies: Wikipedia (CC BY-SA). Fonts: Anybody, Atkinson Hyperlegible and IBM Plex Mono from Google Fonts.
