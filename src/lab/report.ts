import { LAB_VERSION, STRATEGIES, evaluateLab, validateMonthlyRows } from './engine'
import type { LabConfig, LabEvaluation, MonthlyRow } from './engine'
import type { Dataset } from './data'
import { MODEL_VERSION } from '../atlas/engine'

export type BuildProvenance = { sourceCommit: string | null; sourceTreeDirty: boolean | null }
const REPO = 'https://github.com/Chencharl/Trade_bo'
export const REPLAY_TOLERANCE = 1e-10

export function createLabReport(
  dataset: Dataset,
  evaluation: LabEvaluation,
  build: BuildProvenance,
) {
  const revision =
    build.sourceCommit && /^[a-f0-9]{40}$/.test(build.sourceCommit) ? build.sourceCommit : null
  return {
    engine: LAB_VERSION,
    atlasModelVersion: MODEL_VERSION,
    exportedAt: new Date().toISOString(),
    sourceCommit: revision,
    sourceTreeDirty: build.sourceTreeDirty,
    dataset,
    rules: STRATEGIES,
    evaluation,
    execution:
      'Signals use completed months only. Targets rebalance at the next monthly boundary. Turnover uses prior drifted holdings; proportional costs precede returns. Each evaluation starts in cash; no terminal liquidation.',
    interpretation:
      'Exploratory evaluation. Synthetic data are not market performance. Imported snapshots may be revised and are not verified point-in-time or directly investable. Bootstrap intervals omit strategy-search uncertainty. No execution, forecasts, or alpha claims.',
    methodology: `${REPO}/blob/${revision || 'main'}/docs/STRATEGY_LAB.md`,
  }
}

type RecordValue = Record<string, unknown>
function record(value: unknown, name: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${name} must be an object.`)
  return value as RecordValue
}

function keys(value: RecordValue, expected: string[], name: string) {
  if (Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0'))
    throw new Error(`Unexpected fields at ${name}.`)
}

function text(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${name} must be text.`)
}

function compare(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === 'number') {
    if (
      /\.(seed|bootstrapSeed|blockLength|replicates|developmentMonths|holdoutMonths|costBps)$/.test(
        path,
      )
    ) {
      if (actual !== expected) throw new Error(`Recomputed parameter or count differs at ${path}.`)
      return
    }
    if (
      typeof actual !== 'number' ||
      !Number.isFinite(actual) ||
      Math.abs(actual - expected) > REPLAY_TOLERANCE * Math.max(1, Math.abs(expected))
    )
      throw new Error(`Recomputed result differs at ${path}.`)
    return
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length)
      throw new Error(`Unexpected array at ${path}.`)
    expected.forEach((value, index) => compare(actual[index], value, `${path}[${index}]`))
    return
  }
  if (expected && typeof expected === 'object') {
    const object = record(actual, path)
    const fields = expected as RecordValue
    if (Object.keys(object).sort().join('\0') !== Object.keys(fields).sort().join('\0'))
      throw new Error(`Unexpected fields at ${path}.`)
    for (const key of Object.keys(fields)) compare(object[key], fields[key], `${path}.${key}`)
    return
  }
  if (actual !== expected) throw new Error(`Recomputed result differs at ${path}.`)
}

/** Recompute every reported ledger and metric. This verifies calculations, not data authenticity or investment merit. */
export async function verifyLabReport(value: unknown) {
  const report = record(value, 'Report')
  keys(
    report,
    [
      'engine',
      'atlasModelVersion',
      'exportedAt',
      'sourceCommit',
      'sourceTreeDirty',
      'dataset',
      'rules',
      'evaluation',
      'execution',
      'interpretation',
      'methodology',
    ],
    'Report',
  )
  for (const name of [
    'engine',
    'atlasModelVersion',
    'exportedAt',
    'execution',
    'interpretation',
    'methodology',
  ])
    text(report[name], name)
  if (!/^atlas-\d+$/.test(report.atlasModelVersion as string))
    throw new Error('Invalid Atlas model version.')
  const timestamp = Date.parse(report.exportedAt as string)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== report.exportedAt)
    throw new Error('Invalid export timestamp.')
  if (
    report.sourceCommit !== null &&
    (typeof report.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(report.sourceCommit))
  )
    throw new Error('Invalid source commit.')
  if (report.sourceTreeDirty !== null && typeof report.sourceTreeDirty !== 'boolean')
    throw new Error('Invalid source-tree status.')
  if (report.methodology !== `${REPO}/blob/${report.sourceCommit || 'main'}/docs/STRATEGY_LAB.md`)
    throw new Error('Methodology revision does not match the recorded source.')
  if (report.engine !== LAB_VERSION)
    throw new Error(
      `Report engine ${String(report.engine)} does not match ${LAB_VERSION}; use the matching source release.`,
    )
  compare(report.rules, STRATEGIES, 'rules')
  const dataset = record(report.dataset, 'dataset')
  keys(dataset, ['name', 'kind', 'source', 'notes', 'rows', 'rawSha256', 'dataSha256'], 'dataset')
  for (const name of ['name', 'kind', 'source', 'dataSha256'])
    text(dataset[name], `dataset.${name}`)
  if (!['synthetic', 'imported'].includes(dataset.kind as string))
    throw new Error('Invalid dataset kind.')
  if (!/^[a-f0-9]{64}$/.test(dataset.dataSha256 as string))
    throw new Error('Invalid canonical data hash.')
  if (
    dataset.rawSha256 !== null &&
    (typeof dataset.rawSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(dataset.rawSha256))
  )
    throw new Error('Invalid original-file hash.')
  if (!Array.isArray(dataset.notes) || !dataset.notes.every((note) => typeof note === 'string'))
    throw new Error('Dataset notes must be text entries.')
  validateMonthlyRows(dataset.rows as MonthlyRow[])
  for (const row of dataset.rows as MonthlyRow[])
    keys(record(row, 'row'), ['date', 'marketReturn', 'cashReturn'], 'dataset row')
  const rows = (dataset.rows as MonthlyRow[]).map(({ date, marketReturn, cashReturn }) => ({
    date,
    marketReturn,
    cashReturn,
  }))
  const bytes = new TextEncoder().encode(JSON.stringify(rows))
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  if (dataset.dataSha256 !== hash)
    throw new Error('Canonical data SHA-256 does not match the report rows.')
  const evaluation = record(report.evaluation, 'evaluation')
  const supplied = record(evaluation.config, 'evaluation.config')
  const config = {
    costBps: supplied.costBps,
    selectedStrategy: supplied.selectedStrategy,
    bootstrapSeed: supplied.bootstrapSeed,
  } as LabConfig
  const recomputed = evaluateLab(rows, config)
  compare(evaluation, recomputed, 'evaluation')
  return {
    calculationMatches: true,
    engine: LAB_VERSION,
    dataSha256: hash,
    observations: rows.length,
    tolerance: REPLAY_TOLERANCE,
    sourceCommit: report.sourceCommit ?? null,
    sourceTreeDirty: report.sourceTreeDirty ?? null,
    dataAuthenticityVerified: false,
    rawFileHashVerified: false,
    sourceCommitVerified: false,
  }
}
