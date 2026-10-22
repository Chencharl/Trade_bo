import { Unzip, UnzipInflate, unzipSync } from 'fflate'
import type { UnzipFileInfo } from 'fflate'
import type { MonthlyRow } from './engine'

export const DEMO_SOURCE_VERSION = 'synthetic-regimes-1'
const MAX_BYTES = 2 * 1024 * 1024
const MIN_MONTHS = 156
const MAX_MONTHS = 1500
const MAX_RETURN = 10
const FRENCH_DEFINITION =
  'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/f-f_factors.html'
const FRENCH_DOWNLOAD =
  'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_CSV.zip'

export type Dataset = {
  name: string
  kind: 'synthetic' | 'imported'
  source: string
  notes: string[]
  rows: MonthlyRow[]
  rawSha256: string | null
  dataSha256: string
}

type CSVRecord = { cells: string[]; start: number; end: number }

/** A small CSV reader; malformed quoting is an error, never a skipped record. */
function csvRecords(text: string): CSVRecord[] {
  const records: CSVRecord[] = []
  let cells: string[] = []
  let value = ''
  let quoted = false
  let quoteClosed = false
  let start = 0
  const cell = () => {
    cells.push(value)
    value = ''
    quoteClosed = false
  }
  const record = (end: number) => {
    cell()
    records.push({ cells, start, end })
    cells = []
  }
  for (let i = 0; i < text.length; i++) {
    const character = text[i]
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') {
          value += '"'
          i++
        } else {
          quoted = false
          quoteClosed = true
        }
      } else value += character
      continue
    }
    if (character === '"') {
      if (value || quoteClosed) throw new Error('Malformed CSV quotation.')
      quoted = true
    } else if (character === ',') {
      cell()
    } else if (character === '\r' || character === '\n') {
      record(i)
      if (character === '\r' && text[i + 1] === '\n') i++
      start = i + 1
    } else {
      if (quoteClosed) throw new Error('Unexpected text after a quoted CSV field.')
      value += character
    }
  }
  if (quoted) throw new Error('Unclosed CSV quotation.')
  if (start < text.length || cells.length || value || quoteClosed) record(text.length)
  return records
}

const isBlank = (record: CSVRecord) => record.cells.every((value) => value.trim() === '')

function numeric(value: string, label: string): number {
  const trimmed = value.trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed))
    throw new Error(`${label} must contain a number; blanks and missing values are not allowed.`)
  const result = Number(trimmed)
  if (!Number.isFinite(result)) throw new Error(`${label} must be finite.`)
  return result
}

function monthNumber(date: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(date)
  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1 || Number(match[2]) > 12)
    throw new Error(`Invalid monthly date: ${date}. Use YYYY-MM.`)
  return Number(match[1]) * 12 + Number(match[2]) - 1
}

function validateRows(rows: MonthlyRow[]) {
  if (rows.length < MIN_MONTHS || rows.length > MAX_MONTHS)
    throw new Error(`Provide ${MIN_MONTHS} to ${MAX_MONTHS} consecutive monthly records.`)
  let previous: number | null = null
  for (const row of rows) {
    const month = monthNumber(row.date)
    if (previous !== null && month !== previous + 1)
      throw new Error('Monthly dates must be sorted and consecutive, without duplicates or gaps.')
    for (const value of [row.marketReturn, row.cashReturn]) {
      if (!Number.isFinite(value) || value <= -1 || value > MAX_RETURN)
        throw new Error(
          'Supported monthly returns must be finite, greater than -1, and at most +10 (1,000%).',
        )
    }
    previous = month
  }
}

export function parseMonthlyCSV(text: string): {
  rows: MonthlyRow[]
  format: 'canonical' | 'french'
  notes: string[]
} {
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES)
    throw new Error('CSV files must be at most 2 MiB.')
  const source = text.replace(/^\uFEFF/, '')
  const records = csvRecords(source)
  const first = records.findIndex((record) => !isBlank(record))
  if (first < 0) throw new Error('The CSV is empty.')
  const canonical = records[first].cells.map((value) => value.trim())
  if (canonical.length === 3 && canonical.join(',') === 'date,market_return,cash_return') {
    const rows: MonthlyRow[] = []
    let ended = false
    for (const record of records.slice(first + 1)) {
      if (isBlank(record)) {
        ended = true
        continue
      }
      if (ended) throw new Error('Blank records are only allowed after the final monthly row.')
      if (record.cells.length !== 3)
        throw new Error('Canonical CSV rows must have exactly 3 columns.')
      const [date, market, cash] = record.cells
      rows.push({
        date: date.trim(),
        marketReturn: numeric(market, 'market_return'),
        cashReturn: numeric(cash, 'cash_return'),
      })
    }
    validateRows(rows)
    return {
      rows,
      format: 'canonical',
      notes: ['Imported monthly simple returns in decimal units; source supplied by the user.'],
    }
  }

  const header = records.findIndex(
    (record) =>
      record.cells.length === 5 &&
      record.cells.map((value) => value.replace(/\s+/g, '').toLowerCase()).join(',') ===
        ',mkt-rf,smb,hml,rf',
  )
  if (header < 0)
    throw new Error(
      'Use date,market_return,cash_return or the original monthly Fama/French 3-factor CSV.',
    )
  const rows: MonthlyRow[] = []
  for (let index = header + 1; index < records.length; index++) {
    const record = records[index]
    if (isBlank(record)) {
      const next = records.slice(index + 1).find((candidate) => !isBlank(candidate))
      if (next && !/^annual\s+factors\b/i.test(next.cells[0].trim()))
        throw new Error('A blank separator cannot hide later monthly records or unknown content.')
      break
    }
    if (/^annual\s+factors\b/i.test(record.cells[0].trim())) break
    if (record.cells.length !== 5 || !/^\d{6}$/.test(record.cells[0].trim()))
      throw new Error(
        'Invalid French monthly record; expected YYYYMM and exactly 4 factor columns.',
      )
    const [date, ...fields] = record.cells.map((value) => value.trim())
    const values = fields.map((value) => numeric(value, `French factor for ${date}`))
    if (values.some((value) => value === -99.99 || value === -999))
      throw new Error(`French missing-value sentinel found for ${date}.`)
    rows.push({
      date: `${date.slice(0, 4)}-${date.slice(4)}`,
      marketReturn: (values[0] + values[3]) / 100,
      cashReturn: values[3] / 100,
    })
  }
  validateRows(rows)
  return {
    rows,
    format: 'french',
    notes: [
      `Original file header (verbatim, up to 500 characters):\n${source.slice(0, records[header].end).slice(0, 500)}`,
      'French monthly percentages were divided by 100; market return = Mkt-RF + RF. Annual rows are excluded.',
      'The current French series uses CRSP CIZ research returns and revised historical data. Imported older vintages may use FIZ; consult the retained file header. This is not point-in-time data or a tradable fund/index return.',
      `Official definitions: ${FRENCH_DEFINITION}`,
      `Official download: ${FRENCH_DOWNLOAD}`,
      'Uploaded data stay in this browser. Public availability does not establish permission to redistribute the source data.',
    ],
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  // Copy to an owned ArrayBuffer, also avoiding SharedArrayBuffer typing differences.
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function canonicalRows(rows: MonthlyRow[]) {
  return rows.map(({ date, marketReturn, cashReturn }) => ({ date, marketReturn, cashReturn }))
}

async function rowsHash(rows: MonthlyRow[]) {
  return sha256(new TextEncoder().encode(JSON.stringify(canonicalRows(rows))))
}

function zipChecksum(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= Math.max(0, bytes.length - 65557)) {
    if (
      view.getUint32(end, true) === 0x06054b50 &&
      end + 22 + view.getUint16(end + 20, true) === bytes.length
    )
      break
    end--
  }
  if (end < Math.max(0, bytes.length - 65557)) throw new Error('Missing ZIP end directory.')
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== 1 ||
    view.getUint16(end + 10, true) !== 1
  )
    throw new Error('ZIP must contain exactly one CSV file on one disk.')
  const directory = view.getUint32(end + 16, true)
  const size = view.getUint32(end + 12, true)
  if (
    directory + size !== end ||
    size < 46 ||
    directory + 46 > end ||
    view.getUint32(directory, true) !== 0x02014b50
  )
    throw new Error('Malformed ZIP central directory.')
  return view.getUint32(directory + 16, true)
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Metadata preflight plus bounded streaming output; never extract files to disk. */
function unzipCSV(bytes: Uint8Array): Uint8Array {
  if (
    bytes.length < 30 ||
    new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) !== 0x04034b50
  )
    throw new Error('Malformed ZIP archive.')
  if (new DataView(bytes.buffer, bytes.byteOffset).getUint16(6, true) & 1)
    throw new Error('Encrypted ZIP archives are not supported.')
  const entries: UnzipFileInfo[] = []
  try {
    const expectedChecksum = zipChecksum(bytes)
    // Returning false means this first pass reads metadata without allocating inflated files.
    unzipSync(bytes, {
      filter: (entry) => {
        entries.push(entry)
        if (entries.length > 1) throw new Error('ZIP must contain exactly one CSV file.')
        if (!/^[^/\\]+\.csv$/i.test(entry.name))
          throw new Error('ZIP must contain one CSV file at its top level.')
        if (
          entry.originalSize <= 0 ||
          entry.originalSize > MAX_BYTES ||
          entry.size <= 0 ||
          entry.size > bytes.length
        )
          throw new Error('Invalid ZIP sizes, or the expanded CSV exceeds 2 MiB.')
        if (![0, 8].includes(entry.compression))
          throw new Error('Only stored or DEFLATE-compressed CSV ZIPs are supported.')
        return false
      },
    })
    if (entries.length !== 1) throw new Error('ZIP must contain exactly one CSV file.')
    const expected = entries[0]
    let discovered = 0
    let total = 0
    let complete = false
    let failure: Error | null = null
    const chunks: Uint8Array[] = []
    const unzip = new Unzip((file) => {
      discovered++
      if (
        discovered !== 1 ||
        file.name !== expected.name ||
        file.compression !== expected.compression ||
        (file.originalSize !== undefined && file.originalSize !== expected.originalSize) ||
        (file.size !== undefined && file.size !== expected.size)
      )
        throw new Error('ZIP local records do not match its single-file directory.')
      file.ondata = (error, chunk, final) => {
        if (failure) return
        if (error) failure = error
        else {
          total += chunk.byteLength
          if (total > MAX_BYTES || total > expected.originalSize)
            failure = new Error('Expanded ZIP data exceeds its declared size or the 2 MiB limit.')
          else {
            chunks.push(chunk)
            if (final) complete = true
          }
        }
        if (failure) file.terminate()
      }
      file.start()
    })
    unzip.register(UnzipInflate)
    // Small compressed chunks bound intermediate inflation even if size metadata is forged.
    for (let offset = 0; offset < bytes.length; offset += 1024) {
      unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length)
      if (failure) throw failure
    }
    if (discovered !== 1 || !complete || total !== expected.originalSize)
      throw new Error('Truncated ZIP data or inconsistent expanded size.')
    const output = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      output.set(chunk, offset)
      offset += chunk.byteLength
    }
    if (crc32(output) !== expectedChecksum)
      throw new Error('ZIP CRC-32 checksum does not match its CSV.')
    return output
  } catch (error) {
    throw new Error(
      `Cannot import ZIP: ${error instanceof Error ? error.message : 'invalid archive'}`,
    )
  }
}

export async function importDataset(
  bytes: Uint8Array,
  filename: string,
  sourceLabel: string,
): Promise<Dataset> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES)
    throw new Error('Upload a nonempty CSV or ZIP file of at most 2 MiB.')
  const extension = filename.toLowerCase().split('.').at(-1)
  if (extension !== 'csv' && extension !== 'zip') throw new Error('Choose a .csv or .zip file.')
  const extracted = extension === 'zip' ? unzipCSV(bytes) : bytes
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(extracted)
  } catch {
    throw new Error('The CSV must use valid UTF-8 text.')
  }
  const parsed = parseMonthlyCSV(text)
  const label = sourceLabel.trim()
  if (parsed.format === 'canonical' && (label.length < 3 || label.length > 200))
    throw new Error('Describe the source of this canonical CSV in 3 to 200 characters.')
  return {
    name: filename,
    kind: 'imported',
    source: parsed.format === 'french' ? FRENCH_DOWNLOAD : label,
    notes: parsed.notes,
    rows: parsed.rows,
    rawSha256: await sha256(bytes),
    dataSha256: await rowsHash(parsed.rows),
  }
}

export function datasetCSV(rows: MonthlyRow[]): string {
  validateRows(rows)
  return (
    [
      'date,market_return,cash_return',
      ...rows.map((row) => `${row.date},${row.marketReturn},${row.cashReturn}`),
    ].join('\n') + '\n'
  )
}

export async function createDemoDataset(): Promise<Dataset> {
  let state = 0x6f12ab91
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return (((value ^ (value >>> 14)) >>> 0) + 0.5) / 4294967296
  }
  const normal = () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform())
  const regimes = [
    { drift: 0.07, volatility: 0.14, cash: 0.035 },
    { drift: -0.06, volatility: 0.24, cash: 0.015 },
    { drift: 0.025, volatility: 0.09, cash: 0.025 },
  ]
  let regime = 0
  let cashRate = 0.03
  const rows: MonthlyRow[] = []
  for (let month = 0; month < 432; month++) {
    if (uniform() < 0.07) regime = Math.floor(uniform() * regimes.length)
    const assumptions = regimes[regime]
    const marketInnovation = normal()
    const cashInnovation = normal()
    cashRate = Math.max(
      -0.005,
      Math.min(0.08, cashRate + 0.06 * (assumptions.cash - cashRate) + 0.003 * cashInnovation),
    )
    rows.push({
      date: `${1990 + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, '0')}`,
      marketReturn: Number(
        Math.expm1(
          (assumptions.drift - assumptions.volatility ** 2 / 2) / 12 +
            (assumptions.volatility / Math.sqrt(12)) * marketInnovation,
        ).toFixed(10),
      ),
      cashReturn: Number(Math.expm1(cashRate / 12).toFixed(10)),
    })
  }
  validateRows(rows)
  return {
    name: 'Synthetic regime laboratory · 1990–2025',
    kind: 'synthetic',
    source: DEMO_SOURCE_VERSION,
    notes: [
      'Entirely synthetic monthly returns, generated with a fixed seed. Dates are labels and do not reproduce historical market events.',
      'Persistent illustrative drift and volatility regimes use independent market and cash innovations. Cash returns vary; no strategy is guaranteed to outperform.',
      'No real prices, source-market records, market calibration, or investment forecasts are included.',
    ],
    rows,
    rawSha256: null,
    dataSha256: await rowsHash(rows),
  }
}
