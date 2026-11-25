import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { readHistory, HISTORY_HASH } from '../src/lab/crises.ts'
import { studyTiming, TIMING_VERSION } from '../src/lab/timingStudy.ts'

const path = process.argv[2]
if (!path) throw Error('Supply the archived September 2026 French ZIP or CSV.')
const rows = await readHistory(await readFile(path), basename(path))
let buffer = Buffer.alloc(0),
  offset = 0,
  counter = 0
function choose(size) {
  const limit = 2 ** 32 - (2 ** 32 % size)
  for (;;) {
    if (offset === buffer.length) {
      buffer = createHash('sha256')
        .update(TIMING_VERSION + '/20261125/' + counter++)
        .digest()
      offset = 0
    }
    const word = buffer.readUInt32BE(offset)
    offset += 4
    if (word < limit) return word % size
  }
}
process.stdout.write(
  JSON.stringify({ ...studyTiming(rows, choose), dataSha256: HISTORY_HASH }) + '\n',
)
