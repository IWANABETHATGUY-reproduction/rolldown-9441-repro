import { rolldown } from 'rolldown'
import { rm } from 'node:fs/promises'

const outDir = 'dist-rolldown'
await rm(outDir, { recursive: true, force: true })

const bundle = await rolldown({
  input: 'src/entry.js',
  platform: 'node',
})

await bundle.write({
  dir: outDir,
  format: 'esm',
  minify: false,
  sourcemap: false,
})

await bundle.close()
console.log(`built → ${outDir}/`)
