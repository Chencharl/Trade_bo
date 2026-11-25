import { strict as assert } from 'node:assert'
import test from 'node:test'
import { readHistory, replayEpisode } from '../src/lab/crises'
import type { MonthlyRow } from '../src/lab/engine'

const rows: MonthlyRow[] = Array.from({ length: 240 }, (_, i) => ({
  date: new Date(Date.UTC(2001, i, 1)).toISOString().slice(0, 7),
  marketReturn: 0.012,
  cashReturn: 0.001,
}))
const shock = rows.map((row) => (row.date === '2020-02' ? { ...row, marketReturn: -0.3 } : row))

test('a February shock cannot cause a February opening cut and changes March holdings', () => {
  const control = replayEpisode(rows, '2020', 'trend', 10)
  const replay = replayEpisode(shock, '2020', 'trend', 10)
  const at = (date: string) => replay.find((row) => row.date === date)!
  assert.deepEqual(replay.slice(0, 4), control.slice(0, 4))
  assert.equal(at('2020-02').target, 1)
  assert.equal(at('2020-02').latestCut, null)
  assert.equal(at('2020-03').signalThrough, '2020-02')
  assert.equal(at('2020-03').action, 'Reduced')
  assert.deepEqual(at('2020-03').latestCut, { date: '2020-03', from: 1, to: 0 })
  assert.equal(at('2020-03').costBp, 10)
  assert.ok(Math.abs(at('2020-03').fee - at('2020-02').strategyValue * 0.001) < 1e-10)
  assert.equal(at('2020-04').costBp, 0)
  assert.equal(at('2020-04').latestCut?.date, '2020-03')
})

test('carry-in preserves Market and charges only true drift trades to a held target', () => {
  for (const id of ['2008', '2020'] as const) {
    const market = replayEpisode(shock, id, 'market', 100)
    assert.ok(market.every((m) => m.costBp === 0 && m.returnGap === 0 && m.wealthGap === 0))
    assert.ok(Math.abs(market[0].marketValue - 101.2) < 1e-10)
    const balanced = replayEpisode(shock, id, 'balanced', 100)
    assert.ok(balanced.every((m) => m.action === 'Held' && m.latestCut === null && m.costBp > 0))
    const expectedDrift = (0.6 * 1.012) / (0.6 * 1.012 + 0.4 * 1.001)
    assert.ok(Math.abs(balanced[0].fee - Math.abs(expectedDrift - 0.6)) < 1e-10)
  }
})

test('insufficient carry and a different French snapshot are rejected', async () => {
  assert.throws(() => replayEpisode(rows.slice(-30), '2020', 'market', 0), /Insufficient history/)
  const fixture = [
    'Generated test rows',
    ',Mkt-RF,SMB,HML,RF',
    ...rows.map((r) => r.date.replace('-', '') + ',1.0,0,0,0'),
    '',
    ' Annual Factors: January-December',
  ].join('\n')
  await assert.rejects(
    readHistory(new TextEncoder().encode(fixture), 'example.csv'),
    /differs from the September/,
  )
})
