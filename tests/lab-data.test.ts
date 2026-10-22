import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import {
  createDemoDataset,
  datasetCSV,
  DEMO_SOURCE_VERSION,
  importDataset,
  parseMonthlyCSV,
} from '../src/lab/data'

const dates = (count = 156) =>
  Array.from(
    { length: count },
    (_, index) => `${2000 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`,
  )

function canonical(count = 156) {
  return [
    'date,market_return,cash_return',
    ...dates(count).map((date) => `${date},0.01,0.002`),
  ].join('\n')
}

function french(count = 156) {
  return [
    'This file was created for tests; no historical market data.',
    'Synthetic CRSP CIZ vintage 209912.',
    ',Mkt-RF,SMB,HML,RF',
    ...dates(count).map((date) => `${date.replace('-', '')},1.25,-0.50,0.75,0.25`),
    '',
    ' Annual Factors: January-December ',
    ',Mkt-RF,SMB,HML,RF',
    '2000,99,99,99,99',
  ].join('\n')
}

test('synthetic fixture is deterministic, entirely labeled, and has reproducible canonical SHA-256', async () => {
  const first = await createDemoDataset()
  const second = await createDemoDataset()
  assert.deepEqual(first, second)
  assert.equal(first.source, DEMO_SOURCE_VERSION)
  assert.equal(first.kind, 'synthetic')
  assert.equal(first.rawSha256, null)
  assert.equal(
    first.dataSha256,
    '081cc17146cd25a7437f2b1d9dbbf5a216c757f7ab9492b41deb1b6706d18723',
    'Changing the synthetic fixture requires a new source version and reviewed fingerprint.',
  )
  assert.equal(first.rows.length, 432)
  assert.equal(first.rows[0].date, '1990-01')
  assert.equal(first.rows.at(-1)?.date, '2025-12')
  assert.match(first.notes.join(' '), /synthetic/i)
  assert.match(first.notes.join(' '), /do not reproduce historical/)
  assert.match(first.notes.join(' '), /no strategy is guaranteed/)
  assert.ok(first.rows.every((row) => row.marketReturn > -1 && row.cashReturn > -1))
  assert.ok(first.rows.some((row) => row.marketReturn < 0))
  assert.ok(first.rows.some((row) => row.marketReturn > 0))
  assert.ok(new Set(first.rows.map((row) => row.cashReturn)).size > 100)
  assert.equal(
    first.dataSha256,
    createHash('sha256').update(JSON.stringify(first.rows)).digest('hex'),
  )
})

test('canonical CSV round trip preserves every synthetic value and normalized data hash', async () => {
  const demo = await createDemoDataset()
  const csv = datasetCSV(demo.rows)
  const parsed = parseMonthlyCSV(csv)
  assert.equal(parsed.format, 'canonical')
  assert.deepEqual(parsed.rows, demo.rows)
  const imported = await importDataset(strToU8(csv), 'demo.csv', 'Synthetic round-trip fixture')
  assert.equal(imported.kind, 'imported')
  assert.equal(imported.dataSha256, demo.dataSha256)
  assert.equal(imported.rawSha256, createHash('sha256').update(csv).digest('hex'))
})

test('quoted fields, BOM and CRLF are accepted without relaxing canonical schema', () => {
  const csv =
    '\uFEFF' +
    canonical()
      .split('\n')
      .map((line) =>
        line
          .split(',')
          .map((cell) => `"${cell}"`)
          .join(','),
      )
      .join('\r\n')
  assert.deepEqual(parseMonthlyCSV(csv).rows, parseMonthlyCSV(canonical()).rows)
  assert.throws(
    () =>
      parseMonthlyCSV(
        '"date,market_return,cash_return"\n' + canonical().split('\n').slice(1).join('\n'),
      ),
    /Use date/,
  )
  assert.throws(
    () =>
      parseMonthlyCSV(
        canonical().replace(
          'date,market_return,cash_return',
          'date,market_return,cash_return,extra',
        ),
      ),
    /Use date/,
  )
  assert.throws(
    () => parseMonthlyCSV(canonical().replace('2000-01,0.01,0.002', '2000-01,0.01,0.002,extra')),
    /exactly 3/,
  )
  assert.throws(() => parseMonthlyCSV(canonical().replace('2000-01', '"2000-01')), /Unclosed/)
  assert.throws(
    () => parseMonthlyCSV(canonical().replace('2000-01', '"2000-01"x')),
    /Unexpected text/,
  )
})

test('French monthly percentages convert exactly and annual records are excluded', () => {
  const text = french()
  const parsed = parseMonthlyCSV(text)
  assert.equal(parsed.format, 'french')
  assert.equal(parsed.rows.length, 156)
  assert.deepEqual(parsed.rows[0], { date: '2000-01', marketReturn: 0.015, cashReturn: 0.0025 })
  assert.equal(parsed.rows.at(-1)?.date, '2012-12')
  assert.ok(parsed.notes[0].endsWith(text.slice(0, text.indexOf('\n200001'))))
  assert.match(parsed.notes.join(' '), /CIZ/)
  assert.match(parsed.notes.join(' '), /not point-in-time/)
  assert.match(parsed.notes.join(' '), /not point-in-time data or a tradable/)
  // The explicit annual marker is also a boundary without an intervening blank line.
  assert.deepEqual(parseMonthlyCSV(text.replace('\n\n Annual', '\n Annual')).rows, parsed.rows)
  const spacedHeader = text.replace(',Mkt-RF,SMB,HML,RF', ', Mkt-RF , smb , HML , RF ')
  assert.deepEqual(parseMonthlyCSV(spacedHeader).rows, parsed.rows)
})

test('French missing sentinels in every factor column fail instead of becoming returns', () => {
  for (const sentinel of ['-99.99', '-999', '-99.990']) {
    for (let column = 1; column <= 4; column++) {
      const fields = ['200001', '1.25', '-0.50', '0.75', '0.25']
      fields[column] = sentinel
      assert.throws(
        () => parseMonthlyCSV(french().replace('200001,1.25,-0.50,0.75,0.25', fields.join(','))),
        /missing-value sentinel/,
      )
    }
  }
})

test('invalid French rows, daily/annual dates, and unexpected columns cannot masquerade as months', () => {
  const original = '200001,1.25,-0.50,0.75,0.25'
  for (const invalid of [
    '20000101,1.25,-0.50,0.75,0.25',
    '2000,1.25,-0.50,0.75,0.25',
    '200013,1.25,-0.50,0.75,0.25',
    '200001,1.25,-0.50,0.75,',
    '200001,1.25,-0.50,0.75,0.25,extra',
    'broken monthly row',
  ])
    assert.throws(() => parseMonthlyCSV(french().replace(original, invalid)))
  assert.throws(
    () => parseMonthlyCSV(french().replace(',Mkt-RF,SMB,HML,RF', ',Mkt-RF,SMB,HML,RF,extra')),
    /Use date|Invalid French monthly/,
  )
  assert.throws(
    () => parseMonthlyCSV(french().replace(',Mkt-RF,SMB,HML,RF', '",Mkt-RF,SMB,HML,RF"')),
    /Use date|Invalid French monthly/,
  )
})

test('French separator blanks cannot silently truncate a valid monthly history', () => {
  const full = french(168)
  const interrupted = full.replace('201301,', '\n201301,')
  assert.throws(() => parseMonthlyCSV(interrupted), /blank separator cannot hide/i)
  assert.throws(
    () => parseMonthlyCSV(full.replace('201301,', '\nunknown content\n201301,')),
    /blank separator cannot hide/i,
  )
  const monthlyOnly = full.slice(0, full.indexOf('\n\n Annual'))
  assert.equal(parseMonthlyCSV(monthlyOnly + '\n\n').rows.length, 168)
  assert.equal(parseMonthlyCSV(full.replace('\n\n Annual', '\n\n\n Annual')).rows.length, 168)
})

test('canonical chronology rejects duplicates, gaps, unsorted rows and invalid monthly dates', () => {
  for (const changed of [
    '2000-01',
    '2000-04',
    '1999-12',
    '2000-13',
    '2000-00',
    '0000-02',
    '200002',
    '2000-02-01',
  ]) {
    assert.throws(() => parseMonthlyCSV(canonical().replace('2000-02', changed)))
  }
  assert.throws(
    () => parseMonthlyCSV(canonical().replace('2000-02,', '\n2000-02,')),
    /Blank records/,
  )
})

test('supported numeric bounds reject blank, nonfinite, unsafe and nondecimal numeric cells', () => {
  for (const invalid of [
    '',
    ' ',
    'NaN',
    'Infinity',
    '-Infinity',
    '1e400',
    '-1',
    '-2',
    '10.0001',
    '0x10',
    '1_000',
    '2%',
  ]) {
    for (const column of [1, 2]) {
      const values = ['2000-01', '0.01', '0.002']
      values[column] = invalid
      assert.throws(() =>
        parseMonthlyCSV(canonical().replace('2000-01,0.01,0.002', values.join(','))),
      )
    }
  }
  const edge = parseMonthlyCSV(canonical().replace('2000-01,0.01,0.002', '2000-01,-0.999,10'))
  assert.equal(edge.rows[0].marketReturn, -0.999)
  assert.equal(edge.rows[0].cashReturn, 10)
})

test('monthly record count is bounded for canonical and French input', () => {
  for (const makeCSV of [canonical, french]) {
    assert.throws(() => parseMonthlyCSV(makeCSV(155)), /156 to 1500/)
    assert.equal(parseMonthlyCSV(makeCSV(156)).rows.length, 156)
    assert.equal(parseMonthlyCSV(makeCSV(1500)).rows.length, 1500)
    assert.throws(() => parseMonthlyCSV(makeCSV(1501)), /156 to 1500/)
  }
})

test('source labels are required for canonical files while French provenance uses official URLs', async () => {
  for (const label of ['', '  ', 'ab', 'x'.repeat(201)]) {
    await assert.rejects(importDataset(strToU8(canonical()), 'monthly.csv', label), /3 to 200/)
  }
  const imported = await importDataset(strToU8(french()), 'French.CSV', '')
  assert.equal(
    imported.source,
    'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_CSV.zip',
  )
  assert.match(imported.notes.join(' '), /Data_Library\/f-f_factors.html/)
  assert.match(imported.notes.join(' '), /Public availability does not establish permission/)
  const longHeader = 'A'.repeat(600) + '\n' + french()
  const notes = parseMonthlyCSV(longHeader).notes
  assert.equal(notes[0].split('\n').slice(1).join('\n').length, 500)
})

test('one CSV ZIP imports exactly the same rows and canonical hash as its uncompressed form', async () => {
  const text = french()
  const uncompressed = await importDataset(strToU8(text), 'sample.csv', '')
  for (const level of [0, 6] as const) {
    const zipped = zipSync({ 'sample.CSV': strToU8(text) }, { level })
    const imported = await importDataset(zipped, 'sample.zip', '')
    assert.deepEqual(imported.rows, uncompressed.rows)
    assert.equal(imported.dataSha256, uncompressed.dataSha256)
    assert.notEqual(imported.rawSha256, uncompressed.rawSha256)
    assert.equal(imported.rawSha256, createHash('sha256').update(zipped).digest('hex'))
  }
})

test('ZIP ambiguity, paths, unsupported files and malformed bytes are rejected', async () => {
  const csv = strToU8(canonical())
  for (const archive of [
    zipSync({ 'one.csv': csv, 'two.csv': csv }),
    zipSync({ 'one.csv': csv, 'README.txt': strToU8('metadata') }),
    zipSync({ 'data.txt': csv }),
    zipSync({ '../data.csv': csv }),
    zipSync({ 'nested/data.csv': csv }),
    zipSync({}),
    strToU8('not a zip'),
    zipSync({ 'one.csv': csv }).slice(0, -12),
  ])
    await assert.rejects(importDataset(archive, 'sample.zip', 'Synthetic test fixture'))
})

test('ZIP size metadata must agree with local records and actual expanded output', async () => {
  const original = zipSync({ 'sample.csv': strToU8(canonical()) })
  const directory = original.findIndex(
    (_, index) =>
      original[index] === 0x50 &&
      original[index + 1] === 0x4b &&
      original[index + 2] === 0x01 &&
      original[index + 3] === 0x02,
  )
  assert.ok(directory > 0)
  for (const altered of [1, 2 * 1024 * 1024 + 1]) {
    const bytes = original.slice()
    new DataView(bytes.buffer).setUint32(directory + 24, altered, true)
    await assert.rejects(
      importDataset(bytes, 'bad-size.zip', 'Synthetic test fixture'),
      /size|records/i,
    )
  }
  const forged = original.slice()
  new DataView(forged.buffer).setUint32(22, 1, true)
  new DataView(forged.buffer).setUint32(directory + 24, 1, true)
  await assert.rejects(
    importDataset(forged, 'forged-size.zip', 'Synthetic test fixture'),
    /size|expanded/i,
  )
})

test('a corrupted stored ZIP is rejected even when its changed CSV would parse', async () => {
  const bytes = zipSync({ 'sample.csv': strToU8(canonical()) }, { level: 0 })
  const view = new DataView(bytes.buffer)
  const body = 30 + view.getUint16(26, true) + view.getUint16(28, true)
  const text = new TextDecoder().decode(bytes.subarray(body))
  const firstReturn = text.indexOf('0.01')
  assert.ok(firstReturn > 0)
  bytes[body + firstReturn + 3] = '2'.charCodeAt(0)
  await assert.rejects(importDataset(bytes, 'corrupt.zip', 'Synthetic test fixture'), /CRC-32/)
})

test('input bytes and inflated ZIPs are bounded at 2 MiB, and UTF-8 is validated', async () => {
  const oversized = new Uint8Array(2 * 1024 * 1024 + 1).fill(65)
  await assert.rejects(importDataset(oversized, 'large.csv', 'Synthetic test fixture'), /2 MiB/)
  assert.throws(() => parseMonthlyCSV('A'.repeat(oversized.length)), /2 MiB/)
  const compressed = zipSync({ 'large.csv': oversized })
  assert.ok(compressed.byteLength < 2 * 1024 * 1024)
  await assert.rejects(importDataset(compressed, 'large.zip', 'Synthetic test fixture'), /2 MiB/)
  await assert.rejects(
    importDataset(new Uint8Array([0xff, 0xfe]), 'bad.csv', 'Synthetic test fixture'),
    /UTF-8/,
  )
  await assert.rejects(
    importDataset(new Uint8Array(), 'empty.csv', 'Synthetic test fixture'),
    /nonempty/,
  )
  await assert.rejects(
    importDataset(strToU8(canonical()), 'monthly.txt', 'Synthetic test fixture'),
    /\.csv or \.zip/,
  )
})
