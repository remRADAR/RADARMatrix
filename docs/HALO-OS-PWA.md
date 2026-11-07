# Halo OS PWA: installation and device test guide

## Scope and current state

Halo is an integrated visual workspace inside the existing Matrix Console. Its app tiles, quick settings, brightness/volume sliders, clock and window previews are local presentation UI; they do not launch native apps, change phone/TV settings, connect an agent, open a shell, or start a cloud session. The service worker keeps the downloaded app shell and same-origin build assets available after a successful online load. Network-backed features are not provided by this prototype and are not promised to work offline.

This change prepares a Vite PWA build; it does not publish or deploy it. The service-worker scope and manifest assume the Matrix Console is hosted at the origin root (`/`) over HTTPS. The repository's current `vercel.json` routes the root to Brand Studio, so do not use that Vercel root as the Halo install URL. Choose and verify the intended Matrix Console hosting target and its SPA fallback before distributing an installation link. For the existing Cloudflare static-assets workflow, confirm that `/`, `/halo`, the manifest, worker, icons and hashed `/assets/` files are served from the Matrix Console build. Hosting routes, cache headers, DNS and deployments are outside this change.

## iPhone 13 installation

1. Use a current iOS version and open the HTTPS Matrix Console URL in **Safari**. PWA service workers require a secure context (HTTPS, except localhost for development).
2. Open the manifest start URL `/?screen=halo` and wait for Halo to load completely while online. Reopen or refresh once while still online so the newly installed service worker can control the page and complete its initial shell cache.
3. In Safari, tap **Share** → **Add to Home Screen**. Name it **Halo OS**, then tap **Add**. iOS does not use the standard Chromium install prompt; the user performs this Share-sheet action.
4. Launch the Home Screen icon. It should open the standalone Halo surface. To verify offline startup, first launch while online, wait for the shell to load, then enable Airplane Mode and relaunch. Restore connectivity for any service or content that is not part of the cached shell.
5. If updating after a release, reconnect and open the PWA, then close/reopen it after the new service worker has installed. The worker uses versioned caches and replaces old app caches on activation; long-running open windows are not forcibly interrupted.

The manifest includes an iOS touch icon and the page opts into safe-area-aware viewport rendering. Installation, standalone status-bar appearance, on-screen keyboard behavior, notch/home-indicator spacing and offline relaunch still require physical iPhone 13 verification.

## LG Smart TV and first demonstration

1. Before promising mirroring, record the exact LG model number, model year, webOS version and current firmware. Check that model's LG specifications/support page and its TV settings for **Apple AirPlay** / **AirPlay and HomeKit**. AirPlay availability is model- and firmware-dependent; do not infer it from the LG brand or webOS version alone.
2. For the first demo, put the iPhone and TV on the same Wi-Fi network, enable AirPlay on the TV, open iOS Control Center → **Screen Mirroring**, select the TV and enter the on-screen code if requested. This is iOS system screen mirroring, not Google Cast. Do not assume AirPlay is supported until the exact TV model has been checked.
3. If the specific TV supports a browser-based PWA, also test the hosted app directly with the TV remote. Arrow-key focus navigation, native Enter activation, Escape dismissal, visible focus, readable distance sizing and fullscreen are prepared as browser foundations, but remote key mapping varies by model/browser. Fullscreen is feature-detected and may be unavailable.
4. If AirPlay is not supported, stop and choose an explicitly supported AirPlay receiver (for example, a compatible Apple TV) for the first demonstration. A cast protocol is not an equivalent substitute for the requested iPhone screen mirroring path.

## Verification checklist

Automated browser-emulation targets: 390×844 portrait, 844×390 landscape, a 16:9 1920×1080 television-sized viewport, and a desktop viewport. Check no horizontal overflow, visible taskbar and panels, safe-area-aware CSS, keyboard focus/arrow navigation, manifest/service-worker availability, direct Halo launch, offline reload after initial cache, and reduced-motion behavior. Emulation and automated checks do not establish physical-device compatibility.

### Automated checks run for this change

- `npm run typecheck` — passed.
- `npm run build:matrix-console` — passed.
- `npm run test:matrix-console` — passed; the command builds production assets and then checks the PWA artifacts.
- `npm test` — passed (repository foundation tests).
- `npm run test:deployment` — passed; production API returned the expected fail-closed 503, with no listener or deployment.
- Headless Chromium against the production Vite preview — passed at 390×844, 844×390, 1920×1080, and 1365×900: no horizontal overflow, taskbar and phone menu/window panels stayed within the viewport, Halo start route loaded, installability checks reported HTTPS/manifest/service-worker readiness, touch tap and keyboard arrows moved controls, Halo and existing Matrix Console route/history behavior worked, reduced-motion preference was respected, and a controlled offline reload of `/halo` rendered the cached shell.
- axe-core WCAG 2.1/2.2 A/AA scan — no violations found on the Halo main surface or installability panel.
- Lighthouse 13.6 mobile-emulated performance run against the local production preview — 100/100 lab score; FCP 1.5 s, LCP 1.5 s, TBT 0 ms, CLS 0.002. This is a simulated local lab result, not an iPhone measurement.
- Production build output — 255.95 kB JavaScript (77.85 kB gzip) and 42.10 kB CSS (8.93 kB gzip). The repository does not define a lint script; no separate lint command was available.

Browser emulation checks CSS/layout and simulated touch/keyboard input; it does not simulate actual iOS safe-area insets, Safari's Home Screen lifecycle or LG webOS. Physical checks still required: iPhone 13 Safari installation and standalone launch; iPhone portrait/landscape, notch, home indicator, keyboard and offline relaunch; exact LG model AirPlay discovery/mirroring; TV browser and remote behavior; viewing-distance legibility and performance on the television.

## Known limitations

- No physical iPhone 13 or LG TV test has been performed as part of this implementation task.
- There is no wallpaper file in the starter ZIP, so the gradient wallpaper fallback is displayed.
- Halo tiles, quick-setting toggles and sliders are a visual prototype and do not control iOS, tvOS/webOS, networking, audio or display settings.
- The prototype uses standard touch controls and keyboard focus rather than a native iOS gesture layer; TV remote Back-key mapping depends on the browser/remote.
- Browser/terminal/files/gallery/store windows are explanatory previews only; no native apps, shell, persistent storage, agent, model or cloud services are connected.
- Offline support covers the app shell and same-origin assets cached during the initial successful online load. External fonts and any future network-backed functions can be unavailable offline.
- The current repository-level Vercel routing targets Brand Studio rather than Matrix Console. Root-hosting and SPA fallback for the Matrix Console must be selected and verified before installation links are shared.
- Future cache contract changes must increment `CACHE_VERSION` in `apps/matrix-console/public/sw.js`.
