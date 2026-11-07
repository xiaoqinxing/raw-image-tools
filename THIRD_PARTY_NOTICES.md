# Third-party notices

RAW Lab's own source code is licensed under Apache-2.0. The following
components are used at build time, runtime, or are shipped with the web app.
This list is informational; the license text shipped with each component
governs in case of conflict.

## Runtime / shipped

### LibRaw

- Project: https://www.libraw.org/
- License: LGPL-2.1 (library) / CDDL-1.0 (parts)
- Copyright: LibRaw LLC and contributors
- Shipped as WebAssembly in `public/libraw/libraw.wasm`.
- License texts: `public/libraw/LICENSE.LGPL`, `public/libraw/LICENSE.CDDL`;
  copyright notice: `public/libraw/COPYRIGHT`.

LibRaw is dynamically linked through the WebAssembly module boundary and is
distributed under the LGPL-2.1 / CDDL-1.0. Users may replace the WASM binary
with another compatible LibRaw build. Corresponding source for LibRaw is
available from the LibRaw project and the binding package's source repository.

### @colorhythm/libraw-wasm

- Project: https://github.com/colorhythm/libraw-wasm
- License: MIT
- Copyright: colorhythm and contributors
- License text: `public/libraw/LICENSE.libraw-wasm.txt`.

### fast-png

- License: MIT
- Used for PNG encoding/decoding in the render worker.

### fft.js

- License: MIT
- Copyright: Fedor Indutny
- Used for MTF and noise-spectrum FFTs.

### React / React DOM

- License: MIT
- Copyright: Meta Platforms, Inc. and affiliates.

### Zustand

- License: MIT

### Zod

- License: MIT

### Radix UI primitives

- License: MIT
- Packages: react-dialog, react-dropdown-menu, react-slider, react-switch,
  react-tabs, react-tooltip.

### Tailwind CSS

- License: MIT

## Development only

- Vite — MIT
- Vitest — MIT
- Playwright — Apache-2.0
- TypeScript — Apache-2.0
- pngjs — MIT
- pixelmatch — ISC

## Test fixtures

`tests/fixtures/test-gradient.dng`, `tests/fixtures/test-flat.raw`, and `tests/fixtures/test-cc.raw`
are synthetic files generated for this repository. They contain no
third-party image data. The ColorChecker classic sRGB reference values are
publicly published data; attribution: X-Rite / GretagMacbeth ColorChecker
Classic 24 (pre-2014, D65) reference values as reproduced in public tables.
