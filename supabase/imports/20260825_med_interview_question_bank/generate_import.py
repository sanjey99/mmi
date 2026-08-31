#!/usr/bin/env python3
"""Create reviewable, inactive-only CSV drafts from the legacy MMI workbook.

This converter deliberately uses only Python's standard library. It reads the
workbook supplied as its positional argument and writes local proof artifacts to
this directory. Generated CSV payloads are local-only private proof. They must
not be committed. It never copies marking criteria, cached answers, or panel
notes into an output prompt or guidance field.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from xml.etree import ElementTree


EXPECTED_SOURCE_SHA256 = '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71'
SOURCE_NAMESPACE = 'med_interview_question_bank'
OUTPUT_DIRECTORY = Path(__file__).resolve().parent
XML_NAMESPACE = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
CSV_HEADERS = [
    'category',
    'text',
    'difficulty',
    'subcategory',
    'university_tags',
    'is_mmi_suitable',
    'guidance_notes',
    'source_namespace',
    'source_id',
    'source_manifest_sha256',
    'source_batch_id',
]
CATEGORY_MAPPING = {
    'ethics': 'ethics',
    'professionalism': 'ethics',
    'motivation': 'motivation',
    'personal statement': 'motivation',
    'nhs hot topics': 'nhs',
    'nhs & healthcare': 'nhs',
    'task prioritisation': 'teamwork',
    'communication': 'scenarios',
}
DIFFICULTY_MAPPING = {
    'foundation': 'foundation',
    'medium': 'intermediate',
    'intermediate': 'intermediate',
    'advanced': 'advanced',
}
WORKSHEET_NAMES = ['README', 'stations', 'sub_questions', 'marking_criteria', 'panel_questions']


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(64 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def column_index(cell_reference: str) -> int:
    result = 0
    for letter in re.match(r'[A-Z]+', cell_reference).group(0):
        result = result * 26 + ord(letter) - ord('A') + 1
    return result - 1


def read_shared_strings(workbook: zipfile.ZipFile) -> list[str]:
    root = ElementTree.fromstring(workbook.read('xl/sharedStrings.xml'))
    return [
        ''.join(text.text or '' for text in item.iter(f'{XML_NAMESPACE}t'))
        for item in root.findall(f'{XML_NAMESPACE}si')
    ]


def read_worksheet(
    workbook: zipfile.ZipFile,
    worksheet_number: int,
    shared_strings: list[str],
) -> list[tuple[int, list[str]]]:
    root = ElementTree.fromstring(workbook.read(f'xl/worksheets/sheet{worksheet_number}.xml'))
    rows: list[tuple[int, list[str]]] = []
    for row in root.findall(f'.//{XML_NAMESPACE}sheetData/{XML_NAMESPACE}row'):
        values: list[str] = []
        for cell in row.findall(f'{XML_NAMESPACE}c'):
            index = column_index(cell.attrib['r'])
            while len(values) <= index:
                values.append('')
            shared_value = cell.find(f'{XML_NAMESPACE}v')
            inline_value = cell.find(f'{XML_NAMESPACE}is')
            if cell.attrib.get('t') == 's' and shared_value is not None:
                values[index] = shared_strings[int(shared_value.text)]
            elif inline_value is not None:
                values[index] = ''.join(text.text or '' for text in inline_value.iter(f'{XML_NAMESPACE}t'))
            elif shared_value is not None:
                values[index] = shared_value.text or ''
        rows.append((int(row.attrib['r']), values))
    return rows


def to_records(rows: list[tuple[int, list[str]]]) -> tuple[list[tuple[int, dict[str, str]]], int]:
    header = rows[0][1]
    records: list[tuple[int, dict[str, str]]] = []
    repeated_headers = 0
    for source_row, values in rows[1:]:
        padded_values = values + [''] * (len(header) - len(values))
        if padded_values[0] == header[0]:
            repeated_headers += 1
            continue
        if not any(padded_values):
            continue
        records.append((source_row, dict(zip(header, padded_values))))
    return records, repeated_headers


def normalized_tags(value: str) -> str:
    return ','.join(tag.strip().lower() for tag in value.split(',') if tag.strip())


def map_category(value: str) -> str:
    try:
        return CATEGORY_MAPPING[value.strip().lower()]
    except KeyError as error:
        raise ValueError(f'Unsupported source category: {value!r}') from error


def map_difficulty(value: str) -> str:
    try:
        return DIFFICULTY_MAPPING[value.strip().lower()]
    except KeyError as error:
        raise ValueError(f'Unsupported source difficulty: {value!r}') from error


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open('w', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=CSV_HEADERS, lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit('Usage: generate_import.py /path/to/med_interview_question_bank.xlsx')

    source = Path(sys.argv[1]).resolve()
    if source.name != 'med_interview_question_bank.xlsx':
        raise SystemExit('The source filename must be med_interview_question_bank.xlsx.')
    if sha256_file(source) != EXPECTED_SOURCE_SHA256:
        raise SystemExit('Source SHA-256 does not match the approved workbook.')

    with zipfile.ZipFile(source) as workbook:
        shared_strings = read_shared_strings(workbook)
        worksheets = {
            name: read_worksheet(workbook, index + 1, shared_strings)
            for index, name in enumerate(WORKSHEET_NAMES)
        }

    station_records, station_headers_removed = to_records(worksheets['stations'])
    sub_question_records, sub_question_headers_removed = to_records(worksheets['sub_questions'])
    criterion_records, criterion_headers_removed = to_records(worksheets['marking_criteria'])
    panel_records, panel_headers_removed = to_records(worksheets['panel_questions'])

    stations = {
        record['station_id']: (source_row, record)
        for source_row, record in station_records
        if re.fullmatch(r'MMI_\d{3}', record.get('station_id', ''))
    }
    raw_sub_questions = [
        (source_row, record)
        for source_row, record in sub_question_records
        if re.fullmatch(r'MMI_\d{3}_Q\d+', record.get('sub_q_id', ''))
    ]
    panels = [
        (source_row, record)
        for source_row, record in panel_records
        if re.fullmatch(r'PANEL_\d{3}', record.get('question_id', ''))
    ]

    unique_sub_questions: list[tuple[int, dict[str, str]]] = []
    seen_sub_question_rows: set[tuple[str, ...]] = set()
    for source_row, record in raw_sub_questions:
        identity = tuple(record.get(header, '') for header in (
            'sub_q_id', 'station_id', 'order', 'question_text', 'time_limit_sec', 'model_answer_cached',
        ))
        if identity not in seen_sub_question_rows:
            seen_sub_question_rows.add(identity)
            unique_sub_questions.append((source_row, record))
    duplicate_rows_deduplicated = len(raw_sub_questions) - len(unique_sub_questions)

    sub_questions_by_station: dict[str, list[tuple[int, dict[str, str]]]] = defaultdict(list)
    for entry in unique_sub_questions:
        sub_questions_by_station[entry[1]['station_id']].append(entry)

    complete_station_ids = {
        station_id
        for station_id in stations
        if [record['order'] for _, record in sub_questions_by_station[station_id]]
        == ['1.0', '2.0', '3.0', '4.0', '5.0']
    }
    broken_relation_count = len(stations) - len(complete_station_ids)

    standard_rows: list[dict[str, str]] = []
    for _, sub_question in unique_sub_questions:
        station_id = sub_question['station_id']
        if station_id not in complete_station_ids:
            continue
        _, station = stations[station_id]
        standard_rows.append({
            'category': map_category(station['category']),
            'text': f"{station['scenario_text']}\n\n{sub_question['question_text']}",
            'difficulty': map_difficulty(station['difficulty']),
            'subcategory': station['topic'],
            'university_tags': normalized_tags(station['uni_tags']),
            'is_mmi_suitable': 'true',
            'guidance_notes': f"timing=prep_time_sec:{station['prep_time_sec']},time_limit_sec:{sub_question['time_limit_sec']}",
            'source_id': f"{station_id}/{sub_question['sub_q_id']}",
        })

    panel_rows = [{
        'category': map_category(panel['station_type']),
        'text': panel['question_text'],
        'difficulty': map_difficulty(panel['difficulty']),
        'subcategory': panel['topic'],
        'university_tags': normalized_tags(panel['uni_tags']),
        'is_mmi_suitable': 'true',
        'guidance_notes': '',
        'source_id': panel['question_id'],
    } for _, panel in panels]

    if len(standard_rows) != 775 or len(panel_rows) != 10:
        raise RuntimeError(f'Unexpected prompt counts: {len(standard_rows)} standard, {len(panel_rows)} panel.')
    if len(complete_station_ids) != 155 or broken_relation_count != 5:
        raise RuntimeError(
            f'Unexpected relationship counts: {len(complete_station_ids)} complete, {broken_relation_count} broken.',
        )
    if duplicate_rows_deduplicated != 25:
        raise RuntimeError(f'Expected 25 exact duplicate rows, found {duplicate_rows_deduplicated}.')

    all_rows = standard_rows + panel_rows
    normalized_prompts = {' '.join(row['text'].split()).lower() for row in all_rows}
    source_ids = {row['source_id'] for row in all_rows}
    if len(all_rows) != len(normalized_prompts) or len(all_rows) != len(source_ids):
        raise RuntimeError('Output contains a duplicate normalized prompt or source identity.')

    artifact_rows = {
        'questions-part-1.csv': [
            {
                **row,
                'source_namespace': SOURCE_NAMESPACE,
                'source_manifest_sha256': EXPECTED_SOURCE_SHA256,
                'source_batch_id': 'questions-part-1',
            }
            for row in all_rows[:500]
        ],
        'questions-part-2.csv': [
            {
                **row,
                'source_namespace': SOURCE_NAMESPACE,
                'source_manifest_sha256': EXPECTED_SOURCE_SHA256,
                'source_batch_id': 'questions-part-2',
            }
            for row in all_rows[500:]
        ],
    }
    for filename, rows in artifact_rows.items():
        if len(rows) > 500:
            raise RuntimeError(f'{filename} exceeds the 500-row importer limit.')
        write_csv(OUTPUT_DIRECTORY / filename, rows)
        if (OUTPUT_DIRECTORY / filename).stat().st_size > 1_000_000:
            raise RuntimeError(f'{filename} exceeds the 1 MB importer limit.')

    def sheet_inventory(name: str, rows: list[tuple[int, list[str]]], repeated_headers: int) -> dict[str, object]:
        return {
            'name': name,
            'max_source_row': rows[-1][0],
            'non_empty_rows': sum(any(value for value in row) for _, row in rows),
            'repeated_headers_removed': repeated_headers,
        }

    artifact_metadata = {
        filename: {
            'rows': len(rows),
            'sha256': sha256_file(OUTPUT_DIRECTORY / filename),
        }
        for filename, rows in artifact_rows.items()
    }
    manifest = {
        'artifact_version': 2,
        'source': {
            'basename': source.name,
            'sha256': EXPECTED_SOURCE_SHA256,
        },
        'sheet_inventory': [
            sheet_inventory('README', worksheets['README'], 0),
            sheet_inventory('stations', worksheets['stations'], station_headers_removed),
            sheet_inventory('sub_questions', worksheets['sub_questions'], sub_question_headers_removed),
            sheet_inventory('marking_criteria', worksheets['marking_criteria'], criterion_headers_removed),
            sheet_inventory('panel_questions', worksheets['panel_questions'], panel_headers_removed),
        ],
        'policy': {
            'repeated_headers_removed': (
                station_headers_removed
                + sub_question_headers_removed
                + criterion_headers_removed
                + panel_headers_removed
            ),
            'exact_duplicate_rows_deduplicated': duplicate_rows_deduplicated,
            'category_mapping': CATEGORY_MAPPING,
            'difficulty_normalization': {
                'medium': 'intermediate',
                'case_insensitive_allowed_values': ['foundation', 'intermediate', 'advanced'],
            },
            'criteria_excluded': True,
            'cached_model_answers_excluded': True,
            'panel_notes_excluded': True,
            'guidance_notes_policy': 'timing metadata only',
            'import_identity': {
                'source_namespace': SOURCE_NAMESPACE,
                'source_manifest_sha256': EXPECTED_SOURCE_SHA256,
                'batch_ids': {
                    filename: rows[0]['source_batch_id']
                    for filename, rows in artifact_rows.items()
                },
            },
        },
        'relationships': {
            'complete_mmi_graphs': len(complete_station_ids),
            'quarantined_broken_relations': broken_relation_count,
            'quarantine_reason': 'Station records without a complete five-question relation were excluded.',
        },
        'prompt_counts': {
            'standard_deduplicated': len(standard_rows),
            'panel_questions': len(panel_rows),
            'total': len(all_rows),
        },
        'artifacts': artifact_metadata,
    }
    (OUTPUT_DIRECTORY / 'manifest.json').write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + '\n',
        encoding='utf-8',
    )


if __name__ == '__main__':
    main()
