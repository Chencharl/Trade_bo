import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'

const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const engine = await readFile(new URL('../src/atlas/engine.ts', import.meta.url), 'utf8')
const modelVersion = engine.match(/export const MODEL_VERSION = ['"]([^'"]+)['"]/)?.[1]
if (!modelVersion) throw new Error('Cannot record the simulation model version.')
const labEngine = await readFile(new URL('../src/lab/engine.ts', import.meta.url), 'utf8')
const labVersion = labEngine.match(/export const LAB_VERSION = ['"]([^'"]+)['"]/)?.[1]
if (!labVersion) throw new Error('Cannot record the strategy lab version.')

let sourceCommit = null
let sourceTreeDirty = null
try {
  const root = new URL('../', import.meta.url)
  sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  sourceTreeDirty =
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length >
    0
} catch {
  if (process.env.GITHUB_ACTIONS === 'true') {
    throw new Error('A published build must identify its checked-out Git commit.')
  }
}

await writeFile(
  new URL('../dist/build-info.json', import.meta.url),
  `${JSON.stringify(
    {
      name: metadata.name,
      version: metadata.version,
      modelVersion,
      labVersion,
      sourceCommit,
      sourceTreeDirty,
      builtAt: new Date().toISOString(),
      repository: 'https://github.com/Chencharl/Trade_bo',
    },
    null,
    2,
  )}\n`,
)
