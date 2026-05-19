# Minimal repro for rolldown#9441 / vite 8.0.13 SSR CJS facade chunk-merge regression

Vite 8.0.13 ships rolldown 1.0.1. Vite 8.0.12 ships rolldown 1.0.0. The same source builds with a different chunk graph between them, regressing toward an entry↔leaf chunk cycle around every CJS facade.

The 9-file source is lifted verbatim from rolldown's own regression-lock test [rolldown#9351 fixture `cjs_facade_reexport_merges_into_entry`](https://github.com/rolldown/rolldown/pull/9351/files). 0 runtime deps — vite is the only `devDependency`.

## Run

```sh
npm install
npm install vite@8.0.13
npx vite build --ssr src/entry.js --outDir dist-bad

npm install vite@8.0.12
npx vite build --ssr src/entry.js --outDir dist-good
```

## Output diff

Two CJS facades (`a.js`, `b.js`), each `module.exports = require('./X-impl.js')`. Entry statically imports both and dynamically imports a route chunk that also imports both.

### vite 8.0.13 → 4 chunks, both facades merged into entry, dense cycle

```
dist-bad/entry.js                   1.93 kB
  var require_a = __commonJSMin(...)
  var require_b = __commonJSMin(...)
  export { require_a as n, __toESM as r, require_b as t };

dist-bad/assets/route-*.js          0.29 kB
  import { n as require_a, r as __toESM, t as require_b } from "../entry.js"
  // ← cycle: route is a dynamic child of entry, imports require_* back

dist-bad/assets/child-*.js          0.16 kB
  import { t as require_b } from "../entry.js"
  // ← cycle: same shape, for require_b
```

### vite 8.0.12 → 4 chunks, `b` facade split into own chunk, no cycle for `b`

```
dist-good/assets/b-*.js             1.43 kB           ← dedicated facade chunk
  var require_b = __commonJSMin(...)
  export { __commonJSMin as n, __toESM as r, require_b as t };

dist-good/entry.js                  0.61 kB
  import { n as __commonJSMin, r as __toESM, t as require_b } from "./assets/b-*.js"
  var require_a = __commonJSMin(...)
  export { require_a as t };

dist-good/assets/route-*.js         0.33 kB
  import { r as __toESM, t as require_b } from "./b-*.js"  ← uses b's own chunk
  import { t as require_a } from "../entry.js"             ← still imports require_a back

dist-good/assets/child-*.js         0.16 kB
  import { t as require_b } from "./b-*.js"                ← no entry import at all
```

The 8.0.12 chunker decides `b`'s facade is shared enough to extract into a dedicated chunk; the 8.0.13 chunker decides both facades should be merged back into the entry.

## Why this is a bug

In environments where leaf chunks evaluate before the entry's body finishes — e.g. **Cloudflare Workers SSR with react-router static route manifests** — the cycle manifests at runtime as:

```
TypeError: require_X is not a function
  at top-level of leaf chunk:
    var import_X = __toESM(require_X(), 1)
```

The leaf reads `require_X` from the entry's module record via the static import, but the entry's body hasn't initialized `var require_X = __commonJSMin(...)` yet — TDZ. In our real-world deployment (vite-on-rolldown SSR + `@cloudflare/vite-plugin` + react-router 7) this produces `Cloudflare 1101` on every request.

## Suspected cause

Rolldown PR [#9305 "chunk-optimization: dedupe already-loaded dynamic deps"](https://github.com/rolldown/rolldown/pull/9305) (merged 2026-05-11, shipped in rolldown 1.0.1) hoists CJS facades into the static entry on the theory that the entry "already has" them. The dynamic-import chunks the chunker still emits then statically import the facades back, completing the cycle.

The earlier dominator-placement fix from [rolldown#9164](https://github.com/rolldown/rolldown/pull/9164) (which fixed the related [#9224](https://github.com/rolldown/rolldown/issues/9224) for runtime helpers) does not appear to cover the new facade-merge path.

The new behavior is locked in by the fixture [#9351 `cjs_facade_reexport_merges_into_entry`](https://github.com/rolldown/rolldown/pull/9351) — i.e. the merge is currently considered correct by rolldown's own test suite. The runtime semantics aren't.

## Workarounds for users

1. **Pin vite to 8.0.12** (which ships rolldown 1.0.0). Smallest diff, addresses the root cause.
2. **Force the relevant CJS package into its own chunk** via `build.rolldownOptions.output.codeSplitting.groups` with `test: /node_modules[\\/]<pkg>[\\/]/` and `minSize: 0`. Works on 8.0.13+ but requires identifying every offending package by name.

## Filed at

[rolldown#9441](https://github.com/rolldown/rolldown/issues/9441) (open, `needs-reproduction` — this is the reproduction).
