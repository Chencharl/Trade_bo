// Machine-readable input to the independent Decimal verifier.
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { readHistory, replayEpisode, EPISODES } from '../src/lab/crises.ts'
import { STRATEGIES } from '../src/lab/engine.ts'

const path = process.argv[2]
if (!path || (await stat(path)).size > 2 * 1024 * 1024)
  throw new Error('Supply the archived French CSV or ZIP (up to 2 MiB).')
const rows = await readHistory(await readFile(path), basename(path))
const runs = []
for (const id of Object.keys(EPISODES)) {
  for (const { id: rule } of STRATEGIES) {
    for (const fee of [0, 5, 10, 25, 50, 100])
      runs.push({ id, rule, fee, ledger: replayEpisode(rows, id, rule, fee) })
  }
}
process.stdout.write(JSON.stringify(runs))
