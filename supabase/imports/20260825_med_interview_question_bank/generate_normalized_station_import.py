#!/usr/bin/env python3
"""Normalize the verified private workbook into complete private station payloads.

The script accepts the approved workbook directly and reads its ZIP/XML sheets
with the legacy standard-library helpers. It preserves station, rubric, cached
model-answer, and admin-only panel data without deriving membership from prompt
wording.

Generated JSON payloads contain private candidate content and are ignored. This
script prints only counts and SHA-256 values; it never prints prompt content.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from generate_import import (
    map_category,
    map_difficulty,
    read_shared_strings,
    read_worksheet,
    to_records,
)


EXPECTED_SOURCE_SHA256 = '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71'
SOURCE_NAMESPACE = 'med_interview_question_bank'
OUTPUT_DIRECTORY = Path(__file__).resolve().parent
FLAT_MANIFEST_PATH = OUTPUT_DIRECTORY / 'manifest.json'
NORMALIZED_MANIFEST_PATH = OUTPUT_DIRECTORY / 'normalized-station-manifest.json'
EXPECTED_LEGACY_WORKBOOK_ORDERS = ['1.0', '2.0', '3.0', '4.0', '5.0']
EXPECTED_CSV_HEADERS = [
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
EXPECTED_FLAT_ARTIFACTS = {
    'questions-part-1.csv': {
        'batch_id': 'questions-part-1',
        'rows': 500,
        'sha256': '33769d18edf3872fc0b2b43fa957ed309715067a777607388d6c92f851f77c30',
    },
    'questions-part-2.csv': {
        'batch_id': 'questions-part-2',
        'rows': 285,
        'sha256': '738ba2beca271c1c44f751446c02be930b79e304369a16a81b6e37d937857f0e',
    },
}
PRIVATE_OUTPUT_NAMES = ('normalized-stations-part-1.json', 'normalized-stations-part-2.json')
EXPECTED_NORMALIZED_ARTIFACTS = {
    'normalized-stations-part-1.json': {
        'station_count': 80,
        'sub_question_count': 400,
        'sha256': 'cf1ddfacf222b520f7237257e266009cff5f90db4e9c6fefb7bdc18e8f1f2c2e',
        'canonical_jsonb_payload_sha256': '83164f9cbac54447edd13e023b5d83ace389d5bc0d82629e525ae3ad680c1f3a',
    },
    'normalized-stations-part-2.json': {
        'station_count': 75,
        'sub_question_count': 375,
        'sha256': '2ff3c3ca74131b4987c0b3efb09aafc521fb7c507daf94e3abd71ccc7e6c708e',
        'canonical_jsonb_payload_sha256': 'fd91a790ac99e6fb87facb1f121abd54d407abe7c7f6315c379cb966230e2cf0',
    },
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(64 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    try:
        parsed = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f'Unable to read required metadata artifact: {path.name}') from error
    if not isinstance(parsed, dict):
        raise ValueError(f'Required metadata artifact is not an object: {path.name}')
    return parsed


def validate_flat_manifest(manifest: dict[str, Any]) -> None:
    source = manifest.get('source')
    identity = manifest.get('policy', {}).get('import_identity') if isinstance(manifest.get('policy'), dict) else None
    artifacts = manifest.get('artifacts')
    prompt_counts = manifest.get('prompt_counts')
    if source != {'basename': 'med_interview_question_bank.xlsx', 'sha256': EXPECTED_SOURCE_SHA256}:
        raise ValueError('Flat manifest source identity is not verified.')
    if not isinstance(identity, dict) or identity.get('source_namespace') != SOURCE_NAMESPACE or identity.get('source_manifest_sha256') != EXPECTED_SOURCE_SHA256:
        raise ValueError('Flat manifest provenance identity is not verified.')
    if not isinstance(artifacts, dict) or not isinstance(prompt_counts, dict):
        raise ValueError('Flat manifest metadata is incomplete.')
    if prompt_counts != {'standard_deduplicated': 775, 'panel_questions': 10, 'total': 785}:
        raise ValueError('Flat manifest prompt counts are not verified.')
    for filename, expected in EXPECTED_FLAT_ARTIFACTS.items():
        if artifacts.get(filename) != {'rows': expected['rows'], 'sha256': expected['sha256']}:
            raise ValueError(f'Flat manifest artifact metadata is not verified: {filename}')
        if identity.get('batch_ids', {}).get(filename) != expected['batch_id']:
            raise ValueError(f'Flat manifest batch identity is not verified: {filename}')


def parse_tags(value: str) -> list[str]:
    tags = [tag.strip().lower() for tag in value.split(',') if tag.strip()]
    if len(tags) != len(set(tags)):
        raise ValueError('Flat artifact contains duplicate university tags.')
    return tags


def split_candidate_group_texts(combined_rows: list[str]) -> tuple[str, list[str]]:
    if len(combined_rows) != 5 or any(not isinstance(row, str) or not row for row in combined_rows):
        raise ValueError('Candidate group must contain exactly five non-empty combined rows.')
    if len(set(combined_rows)) != 5:
        raise ValueError('Candidate group combined rows must be distinct.')

    common_prefix = combined_rows[0]
    for row in combined_rows[1:]:
        prefix_length = 0
        for left, right in zip(common_prefix, row):
            if left != right:
                break
            prefix_length += 1
        common_prefix = common_prefix[:prefix_length]
        if not common_prefix:
            break

    boundary_index = common_prefix.rfind('\n\n')
    if boundary_index <= 0:
        raise ValueError('Candidate group has no unambiguous shared structural scenario boundary.')
    scenario_text = common_prefix[:boundary_index]
    prefix = f'{scenario_text}\n\n'
    prompts = [row[len(prefix):] if row.startswith(prefix) else '' for row in combined_rows]
    if not scenario_text or any(not prompt for prompt in prompts) or len(set(prompts)) != 5:
        raise ValueError('Candidate group structural scenario boundary is inconsistent.')
    return scenario_text, prompts


def read_verified_flat_rows() -> tuple[list[dict[str, Any]], int]:
    flat_manifest = load_json(FLAT_MANIFEST_PATH)
    validate_flat_manifest(flat_manifest)
    candidates: list[dict[str, Any]] = []
    panel_count = 0
    seen_source_ids: set[str] = set()

    for filename, expected in EXPECTED_FLAT_ARTIFACTS.items():
        artifact_path = OUTPUT_DIRECTORY / filename
        if not artifact_path.is_file() or sha256_file(artifact_path) != expected['sha256']:
            raise ValueError(f'Flat private artifact hash is not verified: {filename}')
        with artifact_path.open(encoding='utf-8', newline='') as stream:
            reader = csv.DictReader(stream)
            if reader.fieldnames != EXPECTED_CSV_HEADERS:
                raise ValueError(f'Flat private artifact headers are not verified: {filename}')
            rows = list(reader)
        if len(rows) != expected['rows']:
            raise ValueError(f'Flat private artifact row count is not verified: {filename}')

        for row in rows:
            if set(row) != set(EXPECTED_CSV_HEADERS):
                raise ValueError('Flat private artifact row shape is not verified.')
            if row['source_namespace'] != SOURCE_NAMESPACE or row['source_manifest_sha256'] != EXPECTED_SOURCE_SHA256 or row['source_batch_id'] != expected['batch_id']:
                raise ValueError('Flat private artifact provenance fields are not verified.')
            source_id = row['source_id']
            if source_id in seen_source_ids:
                raise ValueError('Flat private artifact contains duplicate source identity.')
            seen_source_ids.add(source_id)

            if re.fullmatch(r'PANEL_\d{3}', source_id):
                panel_count += 1
                continue

            matched = re.fullmatch(r'(MMI_\d{3})/(MMI_\d{3}_Q\d+)', source_id)
            if matched is None:
                raise ValueError('Flat private artifact contains an unsupported source identity.')
            station_id, sub_q_id = matched.groups()
            if not re.fullmatch(r'MMI_\d{3}', station_id) or not re.fullmatch(r'MMI_\d{3}_Q\d+', sub_q_id):
                raise ValueError('Candidate provenance identity is invalid.')
            prompt_order = int(sub_q_id.rsplit('_Q', 1)[1])
            if prompt_order not in {1, 2, 3, 4, 5}:
                raise ValueError('Candidate provenance order is invalid.')
            candidates.append({
                'station_id': station_id,
                'sub_q_id': sub_q_id,
                'order_num': prompt_order,
                'combined_text': row['text'],
                'source_flat_id': source_id,
                'category': row['category'],
                'topic': row['subcategory'],
                'difficulty': row['difficulty'],
                'university_tags': parse_tags(row['university_tags']),
            })

    if len(seen_source_ids) != 785 or len(candidates) != 775 or panel_count != 10:
        raise ValueError('Flat private artifact candidate/panel counts are not verified.')
    return candidates, panel_count


def normalize_stations(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        grouped[candidate['station_id']].append(candidate)

    stations: list[dict[str, Any]] = []
    for station_id in sorted(grouped):
        prompts = sorted(grouped[station_id], key=lambda candidate: candidate['order_num'])
        orders = [prompt['order_num'] for prompt in prompts]
        if orders != [1, 2, 3, 4, 5]:
            raise ValueError('Candidate station does not have exactly five ordered sub-questions.')
        for prompt in prompts:
            expected_sub_q_id = f"{station_id}_Q{prompt['order_num']}"
            if prompt['sub_q_id'] != expected_sub_q_id:
                raise ValueError('Candidate sub-question provenance does not belong to its station.')
            if prompt['source_flat_id'] != f"{station_id}/{prompt['sub_q_id']}":
                raise ValueError('Candidate flat provenance identity is inconsistent.')
        if len({prompt['sub_q_id'] for prompt in prompts}) != 5 or len({prompt['source_flat_id'] for prompt in prompts}) != 5:
            raise ValueError('Candidate station provenance is inconsistent.')
        first = prompts[0]
        if any(
            (prompt['category'], prompt['topic'], prompt['difficulty'], prompt['university_tags'])
            != (first['category'], first['topic'], first['difficulty'], first['university_tags'])
            for prompt in prompts[1:]
        ):
            raise ValueError('Candidate station metadata is inconsistent.')
        combined_rows = [
            prompt.get('combined_text')
            if isinstance(prompt.get('combined_text'), str)
            else f"{prompt.get('scenario_text', '')}\n\n{prompt.get('question_text', '')}"
            for prompt in prompts
        ]
        scenario_text, question_texts = split_candidate_group_texts(combined_rows)
        stations.append({
            'station_id': station_id,
            'category': first['category'],
            'topic': first['topic'],
            'difficulty': first['difficulty'],
            'university_tags': first['university_tags'],
            'prep_time_sec': 60,
            'scenario_text': scenario_text,
            'sub_questions': [
                {
                    'sub_q_id': prompt['sub_q_id'],
                    'order_num': prompt['order_num'],
                    'question_text': question_text,
                    'time_limit_sec': 120,
                    'source_flat_id': prompt['source_flat_id'],
                }
                for prompt, question_text in zip(prompts, question_texts)
            ],
        })

    if len(stations) != 155 or sum(len(station['sub_questions']) for station in stations) != 775:
        raise ValueError('Normalized candidate station counts are not verified.')
    return stations


def normalize_content(
    station_records: list[tuple[int, dict[str, str]]],
    sub_question_records: list[tuple[int, dict[str, str]]],
    criterion_records: list[tuple[int, dict[str, str]]],
    panel_records: list[tuple[int, dict[str, str]]],
) -> dict[str, object]:
    """Return validated candidate stations, panels, and a content-free report."""
    stations_by_id: dict[str, tuple[int, dict[str, str]]] = {}
    for source_row, station in station_records:
        station_id = station.get('station_id', '').strip()
        if not re.fullmatch(r'MMI_\d{3}', station_id):
            continue
        if station_id in stations_by_id:
            raise ValueError('Workbook contains duplicate candidate station identities.')
        stations_by_id[station_id] = (source_row, station)

    questions_by_station: dict[str, list[tuple[int, dict[str, str]]]] = defaultdict(list)
    seen_questions: dict[str, dict[str, str]] = {}
    duplicate_question_ids: set[str] = set()
    for source_row, question in sub_question_records:
        sub_q_id = question.get('sub_q_id', '').strip()
        if not re.fullmatch(r'MMI_\d{3}_Q\d+', sub_q_id):
            continue
        if sub_q_id in seen_questions:
            duplicate_question_ids.add(sub_q_id)
            continue
        seen_questions[sub_q_id] = question
        station_id = question.get('station_id', '').strip()
        try:
            order_num = int(float(question.get('order', '')))
        except ValueError as error:
            raise ValueError('Candidate sub-question order is invalid.') from error
        if sub_q_id != f'{station_id}_Q{order_num}':
            raise ValueError('Candidate sub-question provenance does not belong to its station.')
        questions_by_station[station_id].append((source_row, question))

    usable_station_ids = [
        station_id for station_id in sorted(stations_by_id)
        if [question.get('order', '').strip() for _, question in sorted(
            questions_by_station.get(station_id, []), key=lambda entry: entry[0],
        )] == EXPECTED_LEGACY_WORKBOOK_ORDERS
    ]
    usable_sub_q_ids = {
        question['sub_q_id'].strip()
        for station_id in usable_station_ids
        for _, question in questions_by_station[station_id]
    }

    criteria_by_sub_question: dict[str, list[tuple[int, dict[str, str]]]] = defaultdict(list)
    seen_criteria: dict[str, dict[str, str]] = {}
    duplicate_criterion_records: list[dict[str, str]] = []
    rejected_orphaned_criteria = 0
    for source_row, criterion in criterion_records:
        criterion_id = criterion.get('criterion_id', '').strip()
        if not criterion_id:
            continue
        if criterion_id in seen_criteria:
            duplicate_criterion_records.append(criterion)
            continue
        seen_criteria[criterion_id] = criterion
        sub_q_id = criterion.get('sub_q_id', '').strip()
        if sub_q_id not in usable_sub_q_ids:
            rejected_orphaned_criteria += 1
            continue
        criteria_by_sub_question[sub_q_id].append((source_row, criterion))
    if any(record.get('sub_q_id', '').strip() in usable_sub_q_ids for record in duplicate_criterion_records):
        raise ValueError('Workbook contains duplicate candidate criterion identities.')

    normalized_stations: list[dict[str, Any]] = []
    for station_id in usable_station_ids:
        _, station = stations_by_id[station_id]
        source_image_url = station.get('image_url', '').strip()
        source_status = station.get('status', '').strip().lower()
        if source_image_url.lower() == 'draft':
            source_image_url, source_status = '', 'draft'
        sub_questions: list[dict[str, Any]] = []
        for _, question in sorted(questions_by_station[station_id], key=lambda entry: entry[0]):
            sub_q_id = question['sub_q_id'].strip()
            ordered_criteria = sorted(criteria_by_sub_question[sub_q_id], key=lambda entry: entry[0])
            if len(ordered_criteria) != 4:
                raise ValueError('Candidate sub-question does not have exactly four marking criteria.')
            sub_questions.append({
                'sub_q_id': sub_q_id,
                'order_num': int(float(question['order'])),
                'question_text': question['question_text'].strip(),
                'time_limit_sec': int(float(question.get('time_limit_sec', '').strip() or '120')),
                'model_answer_cached': question.get('model_answer_cached', '').strip() or None,
                'marking_criteria': [
                    {
                        'criterion_id': criterion['criterion_id'].strip(),
                        'order_num': criterion_order,
                        'bullet_text': criterion['bullet_text'].strip(),
                        'source_weight': float(criterion['weight']),
                        'domain': criterion.get('domain', '').strip().lower() or None,
                    }
                    for criterion_order, (_, criterion) in enumerate(ordered_criteria, start=1)
                ],
            })
        normalized_stations.append({
            'station_id': station_id,
            'category': map_category(station['category']),
            'topic': station['topic'].strip(),
            'difficulty': map_difficulty(station['difficulty']),
            'university_tags': parse_tags(station.get('uni_tags', '')),
            'prep_time_sec': int(float(station.get('prep_time_sec', '').strip() or '60')),
            'status': source_status or 'draft',
            'image_url': source_image_url or None,
            'scenario_text': station['scenario_text'].strip(),
            'sub_questions': sub_questions,
        })

    seen_panel_ids: set[str] = set()
    normalized_panels: list[dict[str, Any]] = []
    for _, panel in sorted(panel_records, key=lambda entry: entry[0]):
        question_id = panel.get('question_id', '').strip()
        if not re.fullmatch(r'PANEL_\d{3}', question_id):
            continue
        if question_id in seen_panel_ids:
            raise ValueError('Workbook contains duplicate panel question identities.')
        seen_panel_ids.add(question_id)
        normalized_panels.append({
            'question_id': question_id,
            'category': map_category(panel['station_type']),
            'topic': panel['topic'].strip(),
            'difficulty': map_difficulty(panel['difficulty']),
            'university_tags': parse_tags(panel.get('uni_tags', '')),
            'question_text': panel['question_text'].strip(),
            'model_answer_cached': panel.get('model_answer_cached', '').strip() or None,
            'panel_notes': (panel.get('panel_notes') or panel.get('notes') or '').strip() or None,
            'status': panel.get('status', '').strip().lower() or 'draft',
        })

    criterion_count = sum(len(question['marking_criteria']) for station in normalized_stations for question in station['sub_questions'])
    report = {
        'candidate_station_count': len(normalized_stations),
        'candidate_sub_question_count': sum(len(station['sub_questions']) for station in normalized_stations),
        'candidate_criterion_count': criterion_count,
        'panel_question_count': len(normalized_panels),
        'criteria_per_candidate_sub_question': {'min': 4, 'max': 4},
        'accepted_orphaned_criteria': 0,
        'rejected_orphaned_criteria': rejected_orphaned_criteria,
        'rejected_duplicate_sub_questions': len(duplicate_question_ids),
        'rejected_duplicate_criteria': len(duplicate_criterion_records),
    }
    return {'stations': normalized_stations, 'panel_questions': normalized_panels, 'report': report}


def read_workbook_content(source: Path) -> dict[str, object]:
    with zipfile.ZipFile(source) as workbook:
        shared_strings = read_shared_strings(workbook)
        sheets = {
            name: read_worksheet(workbook, index + 1, shared_strings)
            for index, name in enumerate(['README', 'stations', 'sub_questions', 'marking_criteria', 'panel_questions'])
        }
    return normalize_content(
        to_records(sheets['stations'])[0],
        to_records(sheets['sub_questions'])[0],
        to_records(sheets['marking_criteria'])[0],
        to_records(sheets['panel_questions'])[0],
    )


def write_private_payloads(normalized: dict[str, object]) -> dict[str, dict[str, Any]]:
    stations = normalized['stations']
    panels = normalized['panel_questions']
    if not isinstance(stations, list) or not isinstance(panels, list):
        raise ValueError('Normalized content has an invalid shape.')
    split_index = 80
    parts = (stations[:split_index], stations[split_index:])
    if [len(part) for part in parts] != [80, 75]:
        raise ValueError('Normalized station artifact partition is not verified.')
    artifacts: dict[str, dict[str, Any]] = {}
    for filename, stations_part in zip(PRIVATE_OUTPUT_NAMES, parts):
        output_path = OUTPUT_DIRECTORY / filename
        payload = {
            'artifact_version': 2,
            'source_namespace': SOURCE_NAMESPACE,
            'source_manifest_sha256': EXPECTED_SOURCE_SHA256,
            'stations': stations_part,
            'panel_questions': panels if filename == PRIVATE_OUTPUT_NAMES[0] else [],
        }
        output_path.write_text(json.dumps(payload, sort_keys=True, separators=(',', ':')) + '\n', encoding='utf-8')
        artifacts[filename] = {
            'station_count': len(stations_part),
            'sub_question_count': sum(len(station['sub_questions']) for station in stations_part),
            'sha256': sha256_file(output_path),
            'canonical_jsonb_payload_sha256': hashlib.sha256(
                json.dumps(payload, sort_keys=True, separators=(',', ':')).encode('utf-8'),
            ).hexdigest(),
        }
    return artifacts


def verify_normalized_manifest(artifacts: dict[str, dict[str, Any]], report: dict[str, object]) -> None:
    manifest = load_json(NORMALIZED_MANIFEST_PATH)
    expected = {
        'artifact_version': 2,
        'source': {'basename': 'med_interview_question_bank.xlsx', 'sha256': EXPECTED_SOURCE_SHA256},
        'normalized_flow': {
            'source_namespace': SOURCE_NAMESPACE,
            'candidate_station_count': 155,
            'candidate_sub_question_count': 775,
            **report,
            'sub_question_orders': [1, 2, 3, 4, 5],
            'stable_grouping_source': 'workbook_station_id_and_sub_q_id',
            'missing_or_inconsistent_grouping': 'reject',
            'timing': {
                'scenario_seconds': 60,
                'response_seconds': 120,
                'response_count': 5,
                'total_seconds': 660,
            },
        },
        'private_artifacts': artifacts,
        'policy': {
            'criteria_preserved': True,
            'source_weights_preserved': True,
            'domains_preserved': True,
            'cached_model_answers_preserved_when_non_empty': True,
            'panel_notes_preserved_admin_only': True,
            'orphaned_criteria': 'reject_and_report',
        },
    }
    if manifest != expected:
        raise ValueError('Normalized station metadata manifest does not match verified private artifacts.')


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate verified private normalized MMI station artifacts.')
    parser.add_argument('workbook', type=Path, help='Verified med_interview_question_bank.xlsx source workbook.')
    parser.add_argument('--verify-manifest', action='store_true', help='Require the tracked metadata manifest to match generated private artifact hashes.')
    arguments = parser.parse_args()
    source = arguments.workbook.resolve()
    if source.name != 'med_interview_question_bank.xlsx' or sha256_file(source) != EXPECTED_SOURCE_SHA256:
        raise SystemExit('Source workbook filename or SHA-256 is not approved.')
    normalized = read_workbook_content(source)
    report = normalized['report']
    if not isinstance(report, dict) or report != {
        'candidate_station_count': 155,
        'candidate_sub_question_count': 775,
        'candidate_criterion_count': 3100,
        'panel_question_count': 10,
        'criteria_per_candidate_sub_question': {'min': 4, 'max': 4},
        'accepted_orphaned_criteria': 0,
        'rejected_orphaned_criteria': 200,
        'rejected_duplicate_sub_questions': 25,
        'rejected_duplicate_criteria': 0,
    }:
        raise ValueError('Normalized workbook content counts are not verified.')
    artifacts = write_private_payloads(normalized)
    if arguments.verify_manifest:
        verify_normalized_manifest(artifacts, report)
    print(json.dumps({**report, 'private_artifacts': artifacts}, sort_keys=True))


if __name__ == '__main__':
    main()
