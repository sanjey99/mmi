import { validateQuestionDraft, type QuestionDraft } from './validation';

const MAX_CSV_BYTES = 1_000_000;
const MAX_DATA_ROWS = 500;
const REQUIRED_HEADERS = ['category', 'text', 'difficulty'] as const;
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
  rows: { sourceRow: number; value: QuestionDraft }[];
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
  if (dataRecords.length > MAX_DATA_ROWS) {
    return { rows: [], errors: [{ row: 1, message: 'CSV files may contain at most 500 data rows.' }] };
  }

  return dataRecords.reduce<ParsedQuestionCsv>((result, record) => {
    const validation = validateQuestionDraft({
      category: cell(record, headers, 'category'),
      text: cell(record, headers, 'text'),
      difficulty: cell(record, headers, 'difficulty'),
      subcategory: cell(record, headers, 'subcategory'),
      university_tags: cell(record, headers, 'university_tags').split(',').map(tag => tag.trim()),
      is_mmi_suitable: ['true', '1', 'yes'].includes(cell(record, headers, 'is_mmi_suitable').toLowerCase()),
      guidance_notes: cell(record, headers, 'guidance_notes'),
      is_active: false,
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
}
