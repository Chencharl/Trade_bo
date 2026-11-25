import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { readHistory, HISTORY_HASH } from '../src/lab/crises.ts'
import { studyReversalFilters } from '../src/lab/reversalFilters.ts'

const path = process.argv[2]
if (!path) throw new Error('Supply the archived French CSV or ZIP.')
const rows = await readHistory(await readFile(path), basename(path))
process.stdout.write(
  JSON.stringify({ ...studyReversalFilters(rows), dataSha256: HISTORY_HASH }) + '\n',
)
