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

## Target television — 55-inch Android 7 device

**The stated target television is a 55-inch Android 7 (Nougat) device.** An earlier revision of this guide assumed an LG webOS television and AirPlay mirroring; that assumption was incorrect for this target and has been corrected. Do not apply LG/webOS, AirPlay, or "smart-TV platform" guidance to this device.

1. **Android 7 has no AirPlay receiver**, and a web app cannot add one. iPhone-to-TV mirroring on this device would require a third-party receiver app installed on the TV; treat any such path as unverified and outside Halo. If an LG webOS TV is used in some other context later, check that exact model against the manufacturer's AirPlay 2 support list and firmware; that guidance does not apply to the Android 7 target.
2. **The supported path is running Halo in the TV's own browser over HTTPS.** Record the exact TV model, its browser engine and version, and the Android 7 patch level before testing, and base every capability claim on that recorded browser, not on the Android version alone.
3. **Capability floors on Android 7.** An updated Chromium-based browser on Android 7 (Chrome received updates up to roughly version 105 on that OS release) supports the app, service workers, the offline shell, and Add-to-Home-Screen. The preinstalled Android 7 "Browser" app and old WebView-based TV browsers generally have no service-worker support and may lack modern JavaScript features: expect an online-only experience there, or a failure to load at all on very old engines. The production bundle targets modern ES2020 JavaScript (roughly Chromium 87+); engines below that floor are unsupported. Nothing below this paragraph should be read as a claim that the stock Android 7 browser was tested.
4. **Remote navigation.** Arrow-key focus movement, Enter activation, Escape dismissal, and visible focus are implemented for keyboard and remote-style input, but remote key mapping (including the Back key) varies by TV browser and must be verified on the device. Fullscreen is feature-detected and may be unavailable.
5. **Distance legibility.** The 16:9 television layout (horizontal launcher shelf with larger tiles) is prepared for large screens, but viewing-distance readability must be confirmed on the actual 55-inch display.
6. **Do not claim physical TV validation until the device is actually tested.** No physical Android 7 TV test has been performed (see Known limitations).

## Browser extensions, Bluetooth and TV input

The Browser tile is a guide to the browser hosting Halo, not a second browser engine. A web app cannot silently add browser extensions or force the host browser's desktop-site mode. Apple's iPhone guide installs Safari extensions through Safari's Manage Extensions/App Store flow and enables them under **Settings → Apps → Safari → Extensions** ([Apple's setup guide](https://support.apple.com/en-ph/guide/iphone/iphab0432bf6/ios)). A desktop extension set belongs in the desktop browser (for example, Chrome's [extension runtime and distribution](https://developer.chrome.com/docs/extensions/get-started)). Standalone Home Screen extension behavior can vary; verify the specific extensions and iOS version relied on.

Halo does not pair a Bluetooth mouse itself. Web Bluetooth is a secure-context, permission-gated API for BLE GATT devices, and current [Safari on iOS support data](https://caniuse.com/web-bluetooth) shows no native Web Bluetooth; the separate [WebHID API](https://caniuse.com/webhid) is also unsupported in Safari on iOS. Normal mouse pairing is an operating-system action. For TV mouse use, pair the mouse in the TV's own settings and run Halo in that TV's browser; the browser can then deliver its supported pointer/click events to the UI. Confirm this on the exact TV/browser.

A mouse paired to the TV must not be assumed to control a mirrored iPhone; the supported arrangement is either Halo running directly in the TV's browser (TV-local input), or the iPhone's own paired pointer for iPhone-local interaction. Network streaming smoothness depends on the Wi-Fi network, receiver, and devices, so the web UI can minimize heavy animation but cannot promise zero lag or a fixed FPS. The supplied wallpaper uses the full 16:9 composition on wide screens and a dedicated 820×1440 left-of-center portrait crop scaled to 82% screen height, preserving the statue and stadium sign together; each image is responsive-preloaded and both are precached for offline orientation changes. Large 16:9 screens use a console-inspired horizontal launcher shelf with larger focusable app tiles and an existing bottom taskbar; the styling is original and does not reuse console artwork. Desktop icons use selected MIT-licensed [Icons8 Liquid Glass components](https://github.com/icons8/liquid-glass-icons), with the license included in source and deployed notices.

## Verification checklist

Automated browser-emulation targets: 390×844 portrait, 844×390 landscape, a 16:9 1920×1080 television-sized viewport, and a desktop viewport. Check no horizontal overflow, visible taskbar and panels, safe-area-aware CSS, keyboard focus/arrow navigation, manifest/service-worker availability, direct Halo launch, both responsive wallpaper preloads and offline copies, browser-host guidance, and reduced-motion behavior. Emulation and automated checks do not establish physical-device compatibility.

### Automated checks run for this change (implementer's local run, recorded before independent audit)

- `npm run typecheck` — passed.
- `npm run build:matrix-console` — passed.
- `npm run test:matrix-console` — passed; the command builds production assets and then checks the PWA artifacts.
- `npm test` — reported as passed (repository foundation tests). *Audit note: at the time of this run the repository test runner was still fail-open (see the next section), so this specific claim could not fail. The runner on this lineage is now fail-closed and enforced in CI.*
- `npm run test:deployment` — passed; production API returned the expected fail-closed 503, with no listener or deployment.
- Headless Chromium against the production Vite preview — passed at 390×844, 844×390, 1920×1080, and 1365×900: no horizontal overflow, taskbar and phone menu/window panels stayed within the viewport, the portrait crop preserved the statue/sign framing, the 16:9 TV viewport showed eight horizontal app tiles above the taskbar, responsive high-priority preloads selected the expected image, both wallpaper files loaded offline from the service worker, installability checks reported HTTPS/manifest/service-worker readiness, touch/keyboard interactions and existing Matrix Console route/history behavior worked, and reduced motion was respected.
- Desktop-pointer Chromium check — passed; hovering a glass app icon produces the category-colored glow and transform.
- axe-core WCAG 2.1/2.2 A/AA scan — no violations found on the Halo main surface, installability panel, or Browser guidance window.
- Lighthouse 13.6 mobile-emulated performance run against the local production preview — 96/100 lab score; FCP 1.5 s, LCP 2.7 s, TBT 30 ms, CLS 0.002. The wallpaper is the LCP element and is now discovered with `fetchpriority=high`; this is a simulated local lab result, not an iPhone measurement.
- Production build output — 282.41 kB JavaScript (83.32 kB gzip) and 47.26 kB CSS (9.77 kB gzip); wallpaper WebP assets are 300,970 bytes (wide) and 172,228 bytes (portrait). The repository does not define a lint script; no separate lint command was available.

Browser emulation checks CSS/layout and simulated touch/keyboard input; it does not simulate actual iOS safe-area insets, Safari's Home Screen lifecycle, or an Android 7 TV browser. Physical checks still required: iPhone 13 Safari installation and standalone launch; iPhone portrait/landscape, notch, home indicator, keyboard and offline relaunch; the 55-inch Android 7 television's browser engine/version recording, direct launch, remote navigation, viewing-distance legibility and performance.

## Independent audit corrections (2026-11-07)

An independent audit of PR #17's head (`e57d04e`) found and corrected the following on the `fix/halo-os-pwa-audit-corrections` branch, without changing PR #17 itself:

1. **Fail-open test harness.** The test runner on this lineage ended with an unconditional `process.exit(0)`, so `npm test` exited 0 even with failing assertions and the "npm test — passed" claim above could not fail. The fail-closed runner from the Stage 0.1.1 corrective workstream (PR #15, independently accepted with non-blocking findings) is ported here verbatim (`tests/harness.mjs`, `tests/test-runner.mjs`) so both lineages converge on the same harness.
2. **No CI on this lineage.** `main` carries only `deploy-staging.yml` (no tests), so PR #17's only check run was "Vercel Preview Comments" and none of the checks above had ever executed in CI. A CI workflow (exit-code-enforced tests, swallowed-failure guard, `RESULT: PASSED` assertion, typecheck, Matrix Console build + PWA smoke, fail-closed deployment smoke) now runs on this branch and its PRs.
3. **`Array.prototype.at()` in the load path.** `screenFromLocation` (every app load) and the service-worker navigation handler used `.at(-1)`, which is unavailable on Chromium < 92 — a realistic floor for Android 7-era television browsers — and threw on those engines. Replaced with plain index access; behavior is identical on modern browsers.
4. **Target-device documentation.** The television sections assumed an LG webOS/AirPlay target; the stated target is a 55-inch Android 7 device. The sections above were corrected accordingly.

## Known limitations

- No physical iPhone 13 or Android 7 TV test has been performed. No physical TV validation has occurred, on any device.
- The user-supplied RADARCharts stadium image is now the Halo wallpaper; the full wide and 820×1440 portrait WebP derivatives are preserved in `public/assets/`.
- Halo tiles, quick-setting toggles and sliders are a visual prototype and do not control iOS, Android, networking, audio or display settings.
- The prototype uses standard touch controls and keyboard focus rather than a native iOS gesture layer; TV remote Back-key mapping depends on the browser/remote.
- Browser/terminal/files/gallery/store windows are explanatory previews only; the Browser tile links to system-browser extension guidance but does not embed an independent browser or install extensions. No native apps, shell, persistent storage, agent, model or cloud services are connected.
- Offline support precaches the app shell, both responsive wallpaper variants and PWA icons; same-origin assets are also cached after their first successful online load. External fonts and any future network-backed functions can be unavailable offline.
- The current repository-level Vercel routing targets Brand Studio rather than Matrix Console. Root-hosting and SPA fallback for the Matrix Console must be selected and verified before installation links are shared.
- Future cache contract changes must increment `CACHE_VERSION` in `apps/matrix-console/public/sw.js`.
