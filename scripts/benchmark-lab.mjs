import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { importDataset } from '../src/lab/data.ts'
import { DEFAULT_LAB_CONFIG, STRATEGIES, evaluateLab } from '../src/lab/engine.ts'
const path = process.argv[2]
if (!path) throw new Error('Supply the historical French CSV or ZIP.')
const d = await importDataset(readFileSync(path), path.split('/').pop(), '')
const digest = createHash('sha256')
for (const costBps of [0, 10, 100])
  for (const s of STRATEGIES)
    digest.update(
      JSON.stringify(
        evaluateLab(d.rows, { ...DEFAULT_LAB_CONFIG, costBps, selectedStrategy: s.id }),
      ),
    )
const times = []
for (let i = 0; i < 25; i++) {
  const t = performance.now()
  evaluateLab(d.rows, DEFAULT_LAB_CONFIG)
  times.push(performance.now() - t)
}
times.sort((a, b) => a - b)
console.log(
  JSON.stringify({
    observations: d.rows.length,
    canonical: d.dataSha256,
    raw: d.rawSha256,
    digest: digest.digest('hex'),
    medianMs: times[12],
    p90Ms: times[22],
  }),
)
