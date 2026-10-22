import { readFile, stat } from 'node:fs/promises'
import { verifyLabReport } from '../src/lab/report.ts'

try {
  const path = process.argv[2]
  if (!path || process.argv.length !== 3)
    throw new Error('Usage: npm run verify:report -- /path/to/tradebo-strategy-lab.json')
  if ((await stat(path)).size > 16 * 1024 * 1024)
    throw new Error('Report exceeds the 16 MiB limit.')
  const result = await verifyLabReport(JSON.parse(await readFile(path, 'utf8')))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Report verification failed.')
  process.exitCode = 1
}
