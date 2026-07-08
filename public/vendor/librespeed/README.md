# LibreSpeed client (vendored)

Source: https://github.com/librespeed/speedtest
Vendored commit: `a293ac4cb92031d7b21a5dcde9cdbd62964e9900` (master, fetched 2026-07-08)
Files taken verbatim except the one noted modification below:
- `speedtest.js` — main client interface (`window.Speedtest`). Modified: worker script path
  changed from relative to absolute (`/vendor/librespeed/speedtest_worker.js`) to fix Worker
  resolution on nested app routes.
- `speedtest_worker.js` — background worker that runs the actual transfer test (unmodified)
- `LICENSE` — GNU LGPL-3.0, copied verbatim from upstream

## License

LibreSpeed's client is licensed under the **GNU Lesser General Public License v3.0
(LGPL-3.0)**, per the license headers in both files and the upstream `LICENSE` file
(both fetched directly via `curl` from the upstream `master` branch on 2026-07-08 and
confirmed to contain "GNU LGPLv3 License" banners and the standard LGPLv3 text).

LGPL-3.0 permits linking/using the library from a proprietary application without
requiring the application's own source to be released, provided:
- the library itself is kept intact/replaceable (we serve it unmodified, as separate
  static files under `/vendor/librespeed/`, loaded via `<script src>` — not bundled or
  minified into our own application bundle);
- the license text and copyright notices are preserved (see `LICENSE` and the header
  comments in each `.js` file — do not strip them);
- any modifications *we* make to these files would need to be disclosed under the same
  license. We made one small modification to `speedtest.js` (see above — the worker path
  fix), documented here per the LGPL disclosure requirement, and kept the LGPL notice
  intact. If a future change requires patching these files, document it here too.

This app is an internal business tool (not resold or redistributed to third parties),
so the practical exposure from LGPL's copyleft terms is minimal, but the above
conditions are met regardless.

## How it's used

Loaded client-side via `next/script` (or a plain `<script>` tag) pointing at
`/vendor/librespeed/speedtest.js`, which in turn loads `speedtest_worker.js` as a
Web Worker. See `src/components/firstVisit/WifiSpeedTest.tsx` for the consuming
component, and `src/app/api/first-visit/speedtest/{download,upload,ping}/route.ts`
for the same-origin endpoints it talks to.

## Updating

To update, re-fetch `speedtest.js`, `speedtest_worker.js`, and `LICENSE` from the
upstream repo's `master` branch, update the commit hash above, and diff against the
previous vendored version before committing.
