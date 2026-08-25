import {
  validateQuestionImport,
  type QuestionImportDraft,
} from './importValidation';

const MAX_CSV_BYTES = 1_000_000;
const MAX_DATA_ROWS = 500;
const REQUIRED_HEADERS = [
  'category',
  'text',
  'difficulty',
  'source_namespace',
  'source_id',
  'source_manifest_sha256',
  'source_batch_id',
] as const;
const ALLOWED_HEADERS = new Set([
  ...REQUIRED_HEADERS,
  'subcategory',
  'university_tags',
  'is_mmi_suitable',
  'guidance_notes',
]);

interface CsvRecord {
  cells: string[];
  sourceRow: number;
}

export interface ParsedQuestionCsv {
  rows: { sourceRow: number; value: QuestionImportDraft }[];
  errors: { row: number; message: string }[];
}

function parseRecords(csvText: string): CsvRecord[] {
  const normalized = csvText.replace(/\r\n?/g, '\n');
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let sourceRow = 1;

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '"') {
      if (inQuotes && normalized[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === ',' && !inQuotes) {
      cells = [...cells, field];
      field = '';
    } else if (character === '\n') {
      line += 1;
      if (inQuotes) {
        field += '\n';
      } else {
        const recordCells = [...cells, field];
        if (recordCells.some(cell => cell.trim().length > 0)) {
          records.push({ cells: recordCells, sourceRow });
        }
        cells = [];
        field = '';
        sourceRow = line;
      }
    } else {
      field += character;
    }
  }

  const finalCells = [...cells, field];
  if (finalCells.some(cell => cell.trim().length > 0)) {
    records.push({ cells: finalCells, sourceRow });
  }

  return records;
}

const cell = (record: CsvRecord, headers: readonly string[], name: string) => {
  const index = headers.indexOf(name);
  return index >= 0 ? record.cells[index]?.trim() ?? '' : '';
};

const parseMmiSuitability = (value: string): boolean | null => {
  const normalized = value.toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no', ''].includes(normalized)) return false;
  return null;
};

export function parseQuestionCsv(csvText: string): ParsedQuestionCsv {
  if (new TextEncoder().encode(csvText).byteLength > MAX_CSV_BYTES) {
    return { rows: [], errors: [{ row: 1, message: 'CSV files must be 1 MB or smaller.' }] };
  }

  const records = parseRecords(csvText);
  if (records.length === 0) {
    return { rows: [], errors: [{ row: 1, message: 'CSV file is empty.' }] };
  }

  const headers = records[0].cells.map((header, index) => (
    index === 0 ? header.replace(/^\uFEFF/, '') : header
  ).trim().toLowerCase());
  const duplicateHeader = headers.find((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeader) {
    return { rows: [], errors: [{ row: 1, message: `Duplicate column: ${duplicateHeader}.` }] };
  }
  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) {
      return { rows: [], errors: [{ row: 1, message: `Missing required column: ${required}.` }] };
    }
  }
  const unexpected = headers.find(header => !ALLOWED_HEADERS.has(header));
  if (unexpected) {
    return { rows: [], errors: [{ row: 1, message: `Unsupported column: ${unexpected}.` }] };
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) {
    return { rows: [], errors: [{ row: 1, message: 'CSV file must contain at least one data row.' }] };
  }
  if (dataRecords.length > MAX_DATA_ROWS) {
    return { rows: [], errors: [{ row: 1, message: 'CSV files may contain at most 500 data rows.' }] };
  }

  const parsed = dataRecords.reduce<ParsedQuestionCsv>((result, record) => {
    const isMmiSuitable = parseMmiSuitability(cell(record, headers, 'is_mmi_suitable'));
    if (isMmiSuitable === null) {
      return {
        ...result,
        errors: [...result.errors, { row: record.sourceRow, message: 'MMI suitability must be true/1/yes, false/0/no, or empty.' }],
      };
    }
    const validation = validateQuestionImport({
      category: cell(record, headers, 'category'),
      text: cell(record, headers, 'text'),
      difficulty: cell(record, headers, 'difficulty'),
      subcategory: cell(record, headers, 'subcategory'),
      university_tags: cell(record, headers, 'university_tags').split(',').map(tag => tag.trim()),
      is_mmi_suitable: isMmiSuitable,
      guidance_notes: cell(record, headers, 'guidance_notes'),
      is_active: false,
      source_namespace: cell(record, headers, 'source_namespace'),
      source_id: cell(record, headers, 'source_id'),
      source_manifest_sha256: cell(record, headers, 'source_manifest_sha256'),
      source_batch_id: cell(record, headers, 'source_batch_id'),
    });

    if (!validation.success) {
      return {
        ...result,
        errors: [...result.errors, { row: record.sourceRow, message: validation.issues.join(' ') }],
      };
    }

    return {
      ...result,
      rows: [...result.rows, { sourceRow: record.sourceRow, value: validation.data }],
    };
  }, { rows: [], errors: [] });

  if (parsed.errors.length > 0) return parsed;

  const first = parsed.rows[0]?.value;
  if (!first) return parsed;
  const sourceIds = new Set<string>();
  for (const row of parsed.rows) {
    if (row.value.source_namespace !== first.source_namespace
      || row.value.source_manifest_sha256 !== first.source_manifest_sha256
      || row.value.source_batch_id !== first.source_batch_id) {
      return {
        rows: [],
        errors: [{ row: row.sourceRow, message: 'CSV rows must share one source namespace, manifest, and batch ID.' }],
      };
    }
    if (sourceIds.has(row.value.source_id)) {
      return {
        rows: [],
        errors: [{ row: row.sourceRow, message: 'Duplicate source ID in this import batch.' }],
      };
    }
    sourceIds.add(row.value.source_id);
  }

  return parsed;
}
