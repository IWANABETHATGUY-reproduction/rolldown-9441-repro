# Actual reproduction findings (rolldown#9441)

This file records what was observed when running the repro directly, separate from the framing in `README.md`.

## TL;DR

1. **Runtime behavior did not change.** Running the built output in plain Node produces the expected output with **no runtime error** — under rolldown@1.0.0, rolldown@1.0.1, and rollup@4.60.4.
2. **Rolldown produces the same chunk-graph shape as Rollup.** Both emit a cycle where the entry chunk dynamically imports a leaf, and the leaf statically imports the CJS facade bindings back from the entry. The "merge CJS facade into entry" decision is not Rolldown-specific.

## 1. Runtime: no error

`node dist-rolldown/entry.js` (rolldown@1.0.1, ESM, SSR-equivalent — `platform: 'node'`):

```
entry a b
route a b
child b
exit 0
```

`node dist-rollup/entry.js` (rollup@4.60.4, ESM):

```
entry a b
route a b
child b
exit 0
```

No `TypeError`, no TDZ, no "require_X is not a function". Per ESM spec the cycle is benign: a module's body fully evaluates before any `import()` it kicks off resolves, so by the time the dynamically-loaded leaf reads `require_a` / `require_b` (or `a` / `bExports`) from the entry's module record, those bindings are already populated.

The runtime failure the original README attributes to this cycle (`TypeError: require_X is not a function` → Cloudflare 1101) was **not reproduced** in this repo. To trip it you'd need either:
- a Cloudflare Workers / Miniflare host with the react-router static route manifest that pre-evaluates a leaf chunk before entry, or
- a synthetic harness that explicitly imports the leaf before entry runs.

Neither exists in this repo. As-shipped, both bundlers' outputs run correctly under Node ESM.

## 2. Rolldown and Rollup emit the same cycle

### Rolldown 1.0.1 (`dist-rolldown/`)

`entry.js`:
```js
var require_a = __commonJSMin(...);
var require_b = __commonJSMin(...);
// ...entry body...
import("./route-D1s6gjox.js");
export { require_a as n, __toESM as r, require_b as t };
```

`route-D1s6gjox.js`:
```js
import { n as require_a, r as __toESM, t as require_b } from "./entry.js";
```

`child-CMMGXfjs.js`:
```js
import { t as require_b } from "./entry.js";
```

### Rollup 4.60.4 (`dist-rollup/`)

`entry.js`:
```js
var aExports = requireA();
var a = getDefaultExportFromCjs(aExports);
var bExports = requireB();
// ...entry body...
import('./assets/route-BGvFyBR9.js');
export { a, bExports as b };
```

`assets/route-BGvFyBR9.js`:
```js
import { a, b as bExports } from '../entry.js';
```

`assets/child-CzUKMf3K.js`:
```js
import { b as bExports } from '../entry.js';
```

### Same shape

Both bundlers:
- Place the CJS facade definitions inside the entry chunk.
- Re-export those bindings from entry.
- Generate dynamic-import children that statically import the bindings back from entry.

The structural cycle (`entry → leaf` dynamic, `leaf → entry` static) is **identical** between Rolldown and Rollup. The differences are cosmetic and runtime-shape:

| | What entry exports to leaves | When the binding is populated |
|---|---|---|
| Rolldown 1.0.1 | `require_a` / `require_b` (factory thunks via `__commonJSMin`) | At the `var require_X = __commonJSMin(...)` line in entry body |
| Rollup 4.60.4 | `a` / `bExports` (eager values) | At the `var aExports = requireA()` line in entry body |

Both shapes are spec-safe under ESM evaluation order. Neither fails in plain Node.

## What this means for issue #9441

- The chunking decision the original report calls a regression (rolldown 1.0.0 → 1.0.1: `b` facade merged into entry instead of getting its own chunk) brings Rolldown's output **into alignment with Rollup**, not away from it.
- The locked-in fixture `cjs_facade_reexport_merges_into_entry` (#9351) reflects a chunking choice Rollup also makes.
- If a Cloudflare Workers / react-router production failure is real, the proximate cause is host-side leaf pre-evaluation interacting with the cycle — not a Rolldown-unique bug in the bundled output.
- A bundler-side mitigation (splitting CJS facades into dedicated chunks) would diverge from Rollup's behavior and would be a workaround for the host, not a correctness fix.

## How to reproduce

```sh
pnpm install
pnpm build:rolldown   # → dist-rolldown/
pnpm build:rollup     # → dist-rollup/
node dist-rolldown/entry.js   # entry a b / route a b / child b
node dist-rollup/entry.js     # entry a b / route a b / child b
```
