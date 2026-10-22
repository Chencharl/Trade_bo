import { readFile, stat } from 'node:fs/promises'
import { verifyLabReport } from '../src/lab/report.ts'
import { evaluateRiskAudit } from '../src/lab/risk.ts'
import { evaluateLab } from '../src/lab/engine.ts'

try {
  const path = process.argv[2]
  if (!path || process.argv.length !== 3)
    throw new Error('Usage: npm run audit:risk -- /path/to/tradebo-strategy-lab.json')
  if ((await stat(path)).size > 16 * 1024 * 1024)
    throw new Error('Report exceeds the 16 MiB limit.')
  const report = JSON.parse(await readFile(path, 'utf8'))
  const verification = await verifyLabReport(report)
  // Replay comparison permits small serialization differences. Recompute before
  // applying binary thresholds so an accepted rounding change cannot flip a flag.
  const evaluation = evaluateLab(report.dataset.rows, report.evaluation.config)
  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dataset: {
          name: report.dataset.name,
          kind: report.dataset.kind,
          dataSha256: report.dataset.dataSha256,
        },
        verification,
        audit: evaluateRiskAudit(report.dataset.rows, evaluation),
        interpretation:
          'Retrospective, overlapping monthly loss windows; not independent crashes or calibrated crash probabilities. Exposure flags can follow losses already underway. Synthetic data are not market evidence. Input report source metadata are declarations, not authentication of this audit implementation.',
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Risk audit failed.')
  process.exitCode = 1
}
