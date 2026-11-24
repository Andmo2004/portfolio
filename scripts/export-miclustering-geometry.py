#!/usr/bin/env python3
"""Build the report's heatmaps from the archived study-level CSV.

Each row is one selected Optuna trial for a dataset/scaler/distance/model study.
The independent maxima are descriptive, not held-out performance estimates.
"""
import csv
import json
import math
from collections import Counter
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = root / 'public/miclustering/experiments/resultados_combinados.csv'
target = root / 'src/data/miclustering/geometry.json'
with source.open(newline='', encoding='utf-8-sig') as handle:
    rows = list(csv.DictReader(handle))
models = ['midbscan', 'mikmeans', 'mikmedoids', 'cosmic']
datasets = sorted({row['dataset'] for row in rows})
keys = [(r['dataset'], r['scaler'], r['distance'], r['model']) for r in rows]
if len(rows) != 480 or len(set(keys)) != 480 or len(datasets) != 10:
    raise ValueError('Expected 480 distinct studies across 10 datasets')
if set(r['model'] for r in rows) != set(models):
    raise ValueError('Unexpected models')
if Counter(r['degenerate'] for r in rows) != {'False': 422, 'True': 58}:
    raise ValueError('Unexpected validity counts')
result = {'source': 'resultados_combinados.csv', 'models': models, 'datasets': datasets, 'metrics': {}}
for metric in ('score', 'f1_score'):
    values = []
    for dataset in datasets:
        line = []
        for model in models:
            matching = [r for r in rows if r['dataset'] == dataset and r['model'] == model and r['degenerate'] == 'False']
            numbers = [float(r[metric]) for r in matching]
            if not numbers or not all(math.isfinite(v) for v in numbers):
                raise ValueError(f'Invalid {metric} for {dataset}/{model}')
            line.append(max(numbers))
        values.append(line)
    result['metrics'][metric] = values
target.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(f'Exported {len(datasets)} datasets and {len(models)} models to {target.relative_to(root)}')
