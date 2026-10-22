import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDemoDataset } from '../src/lab/data.ts'
import { DEFAULT_LAB_CONFIG, evaluateLab } from '../src/lab/engine.ts'
import { createLabReport, verifyLabReport } from '../src/lab/report.ts'

async function fixture() {
  const dataset = await createDemoDataset()
  return createLabReport(dataset, evaluateLab(dataset.rows, DEFAULT_LAB_CONFIG), {
    sourceCommit: 'a'.repeat(40),
    sourceTreeDirty: false,
  })
}

test('a saved JSON report independently recomputes all results and binds methodology to its recorded commit', async () => {
  const report = await fixture()
  const result = await verifyLabReport(JSON.parse(JSON.stringify(report)))
  assert.equal(result.calculationMatches, true)
  assert.equal(result.dataAuthenticityVerified, false)
  assert.equal(result.observations, 432)
  assert.equal(result.dataSha256, report.dataset.dataSha256)
  assert.equal(
    report.methodology,
    `https://github.com/Chencharl/Trade_bo/blob/${'a'.repeat(40)}/docs/STRATEGY_LAB.md`,
  )
})

test('replay rejects modified returns, rules, scores, allocations, omitted ledgers, and mismatched versions', async () => {
  const report = await fixture()
  const changes = [
    (r: any) => {
      r.engine = 'lab-1'
    },
    (r: any) => {
      r.dataset.rows[50].marketReturn += 0.01
    },
    (r: any) => {
      r.rules[0].rule = 'Secret rule'
    },
    (r: any) => {
      r.evaluation.frozenSelection.metrics.cagr += 0.01
    },
    (r: any) => {
      r.evaluation.walkForward.baselines[0].ledger[0].targetWeight = 0
    },
    (r: any) => {
      r.evaluation.walkForward.baselines.pop()
    },
    (r: any) => {
      r.evaluation.config.costBps = 200
    },
    (r: any) => {
      r.evaluation.uncertainty.low = null
    },
  ]
  for (const change of changes) {
    const altered = JSON.parse(JSON.stringify(report))
    change(altered)
    await assert.rejects(() => verifyLabReport(altered))
  }
})

test('replay permits documented rounding tolerance but does not authenticate source metadata', async () => {
  const report = await fixture()
  report.evaluation.frozenSelection.metrics.cagr += 1e-12
  report.dataset.source = 'Unverified declaration'
  assert.equal((await verifyLabReport(report)).dataAuthenticityVerified, false)
  report.evaluation.frozenSelection.metrics.cagr += 1e-6
  await assert.rejects(() => verifyLabReport(report), /differs/)
})

test('replay requires typed provenance, exact row schemas, and exact discrete counts', async () => {
  const report = await fixture()
  const changes = [
    (r: any) => {
      r.sourceCommit = { verified: true }
    },
    (r: any) => {
      r.sourceTreeDirty = 'false'
    },
    (r: any) => {
      r.dataset.rows[0].extra = 'untracked'
    },
    (r: any) => {
      r.dataset.notes = [123]
    },
    (r: any) => {
      r.dataset.rawSha256 = 'not-a-hash'
    },
    (r: any) => {
      r.exportedAt = 'yesterday'
    },
    (r: any) => {
      r.evaluation.uncertainty.replicates += 1e-8
    },
    (r: any) => {
      r.evaluation.uncertainty.seed += 1e-8
    },
    (r: any) => {
      r.evaluation.split.holdoutMonths += 1e-10
    },
  ]
  for (const change of changes) {
    const altered = JSON.parse(JSON.stringify(report))
    change(altered)
    await assert.rejects(() => verifyLabReport(altered))
  }
})
