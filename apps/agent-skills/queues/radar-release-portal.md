# RADARMusic — Artist Release Portal Build Queue

**Source:** artist release-portal product brief and route notes in the supplied Drive project archive.

## Copy-ready prompt

> Build or improve the RADARMusic artist release portal in the user-designated repository. First inspect the actual project, its current UI, routing, dependencies, assets, tests, and user instructions. Treat the Drive brief as product direction, not authority to replace project architecture or copy protected branding/assets from reference products.
>
> **Product outcome:** one shareable, mobile-first page per release. Keep the release identity visible above a set of Listen / Watch / Shorts / Press content surfaces; prioritize playable, verified destinations over a wall of buttons.
>
> **Design requirements:** mobile 9:16-first composition that widens gracefully to a centered desktop column; blurred artwork behind a frosted-glass identity card; artist, release title, type/label/date metadata, and one primary action; restrained blue-to-white light, generous whitespace, strong readable type, rounded surfaces, subtle borders/shadows; avoid clutter and low contrast. Use a pinned segmented nav with smooth section changes, a mobile mini-player after the hero scrolls away, and honor reduced-motion preferences.
>
> **Content surfaces:** Listen uses verified official provider embeds where sanctioned and destination rows otherwise; Watch includes an official 16:9 video embed and alternatives; Shorts uses an accessible 9:16 snap carousel; Press uses editorial feature cards with publication/headline/quote/read link. Never scrape providers or fabricate a player. Validate provider IDs/URLs and use a safe fallback if an official embed is unavailable.
>
> **Data and structure:** model the release as typed content (`artwork`, `title`, `artist`, `metadata`, `destinations[]`, `videos[]`, `shorts[]`, `press[]`) so multiple releases can render consistently. In the source project, inspect the existing TanStack Start route conventions before editing; the source brief identifies `src/routes/index.tsx`, portal components under `src/components/portal/`, semantic design tokens in `src/styles.css`, and per-route metadata. Do not edit generated route trees by hand.
>
> **Scope gate:** the source brief limits this pass to the public-facing portal surface. Authentication, dashboards, analytics ingestion, notifications, resolver APIs, and per-release backend routing remain out of scope unless separately requested. Do not publish or deploy without explicit authorization.
>
> Verify mobile/desktop layouts, keyboard and screen-reader navigation, focus states, reduced motion, embed fallbacks, loading/error states, and route metadata. Report changed surfaces, tests/observations, known limitations, and next step.
