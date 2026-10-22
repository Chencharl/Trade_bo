import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDemoDataset, datasetCSV, importDataset } from '../src/lab/data.ts'
import { DEFAULT_LAB_CONFIG, evaluateLab } from '../src/lab/engine.ts'
import { createLabReport, verifyLabReport } from '../src/lab/report.ts'
import { evaluateRiskAudit } from '../src/lab/risk.ts'

const run = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))

test('risk command verifies its input report and reproduces the browser diagnostic', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'tradebo-risk-'))
  try {
    const dataset = await createDemoDataset()
    const evaluation = evaluateLab(dataset.rows, DEFAULT_LAB_CONFIG)
    const report = createLabReport(dataset, evaluation, {
      sourceCommit: null,
      sourceTreeDirty: null,
    })
    const path = join(folder, 'research run.json')
    await writeFile(path, JSON.stringify(report))
    const { stdout } = await run(
      process.execPath,
      ['--import', 'tsx', 'scripts/audit-risk.mjs', path],
      { cwd: root, maxBuffer: 2 * 1024 * 1024 },
    )
    const output = JSON.parse(stdout)
    assert.equal(output.verification.calculationMatches, true)
    assert.equal(output.verification.dataAuthenticityVerified, false)
    assert.equal(output.dataset.kind, 'synthetic')
    assert.equal(output.dataset.dataSha256, dataset.dataSha256)
    assert.deepEqual(output.audit, evaluateRiskAudit(dataset.rows, evaluation))

    report.evaluation.results[0].ledger[0].targetWeight = 0
    await writeFile(path, JSON.stringify(report))
    await assert.rejects(
      run(process.execPath, ['--import', 'tsx', 'scripts/audit-risk.mjs', path], { cwd: root }),
      (error: any) => error.code === 1 && /differs/.test(error.stderr),
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('accepted report rounding cannot flip a binary risk flag at the 50% boundary', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'tradebo-risk-boundary-'))
  try {
    const rows = Array.from({ length: 156 }, (_, i) => ({
      date: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
      marketReturn: i === 86 ? 0.2 : 0,
      cashReturn: 0,
    }))
    const dataset = await importDataset(
      new TextEncoder().encode(datasetCSV(rows)),
      'boundary.csv',
      'Generated threshold fixture',
    )
    const evaluation = evaluateLab(rows, DEFAULT_LAB_CONFIG)
    const expected = evaluateRiskAudit(rows, evaluation)
    const report = createLabReport(dataset, structuredClone(evaluation), {
      sourceCommit: null,
      sourceTreeDirty: null,
    })
    const target = report.evaluation.results.find((rule) => rule.id === 'volatility')!.ledger[0]
    assert.equal(target.targetWeight, 0.5)
    target.targetWeight += 5e-11
    assert.equal((await verifyLabReport(report)).calculationMatches, true)
    assert.notDeepEqual(evaluateRiskAudit(rows, report.evaluation), expected)
    const path = join(folder, 'rounded.json')
    await writeFile(path, JSON.stringify(report))
    const { stdout } = await run(
      process.execPath,
      ['--import', 'tsx', 'scripts/audit-risk.mjs', path],
      { cwd: root, maxBuffer: 2 * 1024 * 1024 },
    )
    assert.deepEqual(JSON.parse(stdout).audit, expected)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
