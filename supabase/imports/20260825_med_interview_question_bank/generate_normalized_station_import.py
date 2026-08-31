#!/usr/bin/env python3
"""Normalize verified private flat prompt artifacts into private station payloads.

The original workbook is intentionally not required at this stage. This script
accepts only the committed flat manifest plus its two verified, ignored CSV
artifacts. It groups candidate prompts exclusively by the source-owned
``MMI_###/MMI_###_Q#`` provenance identity and excludes source-owned
``PANEL_###`` records. It never derives membership from prompt wording.

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
from collections import defaultdict
from pathlib import Path
from typing import Any


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


def write_private_payloads(stations: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    split_index = 80
    parts = (stations[:split_index], stations[split_index:])
    if [len(part) for part in parts] != [80, 75]:
        raise ValueError('Normalized station artifact partition is not verified.')
    artifacts: dict[str, dict[str, Any]] = {}
    for filename, stations_part in zip(PRIVATE_OUTPUT_NAMES, parts):
        output_path = OUTPUT_DIRECTORY / filename
        payload = {
            'artifact_version': 1,
            'source_namespace': SOURCE_NAMESPACE,
            'source_manifest_sha256': EXPECTED_SOURCE_SHA256,
            'stations': stations_part,
        }
        output_path.write_text(json.dumps(payload, sort_keys=True, separators=(',', ':')) + '\n', encoding='utf-8')
        artifacts[filename] = {
            'station_count': len(stations_part),
            'sub_question_count': sum(len(station['sub_questions']) for station in stations_part),
            'sha256': sha256_file(output_path),
            'canonical_jsonb_payload_sha256': EXPECTED_NORMALIZED_ARTIFACTS[filename]['canonical_jsonb_payload_sha256'],
        }
        if artifacts[filename] != EXPECTED_NORMALIZED_ARTIFACTS[filename]:
            raise ValueError(f'Normalized private artifact is not the reviewed payload: {filename}')
    return artifacts


def verify_normalized_manifest(artifacts: dict[str, dict[str, Any]], panel_count: int) -> None:
    manifest = load_json(NORMALIZED_MANIFEST_PATH)
    expected = {
        'artifact_version': 1,
        'source': {'basename': 'med_interview_question_bank.xlsx', 'sha256': EXPECTED_SOURCE_SHA256},
        'normalized_flow': {
            'source_namespace': SOURCE_NAMESPACE,
            'candidate_station_count': 155,
            'candidate_sub_question_count': 775,
            'panel_question_count': panel_count,
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
    }
    if manifest != expected:
        raise ValueError('Normalized station metadata manifest does not match verified private artifacts.')


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate verified private normalized MMI station artifacts.')
    parser.add_argument('--verify-manifest', action='store_true', help='Require the tracked metadata manifest to match generated private artifact hashes.')
    arguments = parser.parse_args()
    candidates, panel_count = read_verified_flat_rows()
    stations = normalize_stations(candidates)
    artifacts = write_private_payloads(stations)
    if arguments.verify_manifest:
        verify_normalized_manifest(artifacts, panel_count)
    print(json.dumps({
        'candidate_station_count': len(stations),
        'candidate_sub_question_count': sum(len(station['sub_questions']) for station in stations),
        'panel_question_count': panel_count,
        'private_artifacts': artifacts,
    }, sort_keys=True))


if __name__ == '__main__':
    main()
