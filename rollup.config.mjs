import { rollup } from 'rollup'
import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import { rm } from 'node:fs/promises'

const outDir = 'dist-rollup'
await rm(outDir, { recursive: true, force: true })

const bundle = await rollup({
  input: 'src/entry.js',
  plugins: [nodeResolve(), commonjs()],
})

await bundle.write({
  dir: outDir,
  format: 'esm',
  entryFileNames: 'entry.js',
  chunkFileNames: 'assets/[name]-[hash].js',
  sourcemap: false,
})

await bundle.close()
console.log(`built → ${outDir}/`)
