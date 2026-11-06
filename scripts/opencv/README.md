# OpenCV.js for the scanner

The scanner runs on `vendor/opencv/opencv.js`, a build of OpenCV.js 4.12.0 with only the `core`
and `imgproc` modules and the functions in `duel-binder.config.py`. It is 1.7 MB against 11 MB for
the full build in `@techstark/opencv-js`, and its runtime starts in about 40 ms instead of 150 ms.
Every function it keeps gives the same output as the full build.

Each bundler config aliases `@techstark/opencv-js` to the vendored file (electron.vite, web,
phone, vitest, scripts/catalog), and the scan tests `require` it directly. The package stays as a
dependency only for its TypeScript types; electron-builder leaves it out of the app.

## Using another OpenCV function

Add it to `duel-binder.config.py`, then rebuild (needs podman, or docker with
`CONTAINER=docker`; the first build takes about 10 minutes):

```sh
bash scripts/opencv/build.sh
```

A function missing from the whitelist is `undefined` on `cv` at runtime, so a call fails with
"cv.foo is not a function". The scan tests cover every function the scanner calls.

`vendor.py` patches the module wrapper so it returns the module object, as the packaged build
did. Emscripten 4's factory returns a promise instead. `build.sh` also removes
`-s DEMANGLE_SUPPORT=1` from OpenCV's CMakeLists, because Emscripten 4 rejects it.
