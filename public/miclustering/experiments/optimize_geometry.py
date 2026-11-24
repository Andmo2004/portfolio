#!/usr/bin/env python3
"""
optimize_geometry.py
====================
Framework de optimización de hiperparámetros para modelos de clustering
Multi-Instance Learning (MIL) basado en criterios de validación geométrica (CVIs).

Metodología:
------------
1. Diseño experimental controlado (Grid Search externo):
   El pipeline anida estrictamente: dataset -> scaler -> distance -> model.
   La matriz de distancias NxN se calcula una única vez por terna (dataset, scaler, distance),
   reutilizándose de forma transparente en todos los modelos e iteraciones de Optuna.

2. Función objetivo de optimización geométrica:
   - Exclusión de puntos de ruido (etiqueta -1).
   - Detección de casos degenerados (< 2 clusters válidos): devuelve score centinela -1.0.
   - Índice Silhouette clásico calculado directamente sobre la matriz de distancias (SilhouetteIndex).
   - Índice Dunn clásico sobre la matriz de distancias (DunnIndex), normalizado mediante:
         Dunn' = Dunn / (Dunn + c)
     donde c es la mediana de las distancias no diagonales de la matriz precalculada.
   - Score de calidad combinado:
         score = 0.5 * Silhouette + 0.5 * Dunn'

3. Estrategia de optimización:
   - Modelos particionales (MIKMeans, MIKMedoids):
         Mono-objetivo: maximizar score.
         Soporte para MIKMeans con distancias vectorizadas (N×K), precomputación
         de BagCentroidCache y control de parámetros max_iters y tol.
   - Modelos basados en densidad (MIDBSCAN, COSMIC):
         Multiobjetivo: maximizar score, minimizar porcentaje de ruido.
         Selección del punto del frente de Pareto mediante distancia mínima
         al punto utópico ideal (score=1.0, ruido=0%).
   - Criterio de parada temprana (Early Stopping) y presupuestos:
         * Modelos particionales (MIKMeans, MIKMedoids): n_trials (50/250), patience=50.
         * Modelos de densidad (MIDBSCAN, COSMIC): max_iter=50 trials, patience=30.

4. Métricas registradas por trial (set_user_attr):
   - CVIs internos: silhouette_raw, dunn_raw, dunn_norm, score, vrc, pbm, noise_pct.
   - BCM (mapeo Húngaro): precision, recall, f1_score, specificity.
   - Parámetros y convergencia: n_clusters, n_iter, hp_*, degenerate.
   - Telemetría temporal: dist_matrix_time, fit_time, silhouette_time, dunn_time,
                          cvi_time, bcm_time, trial_total_time, study_wall_time.

Referencias:
------------
- Dunn, J. C. (1974). Well-separated clusters and optimal fuzzy partitions.
- Rousseeuw, P. J. (1987). Silhouettes: A graphical aid to the interpretation of cluster analysis.
- Calinski, T., & Harabasz, J. (1974). A dendrite method for cluster analysis.
- Pakhira, M. K., Bandyopadhyay, S., & Maulik, U. (2004). Validity index for crisp and fuzzy clusters.
- Kuhn, H. W. (1955). The Hungarian method for the assignment problem.
"""

from __future__ import annotations

import argparse
import inspect
import logging
import os
import sys
import time
import warnings
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
# pyrefly: ignore [unresolved-import, untyped-import]
from scipy.optimize import linear_sum_assignment 
from sklearn import metrics as sk_metrics
from sklearn.metrics import confusion_matrix

import optuna
from miclustering.data.midata import MIData
from miclustering.data.utils import parse_label
from miclustering.distances import DISTANCE_REGISTRY
try:
    from miclustering.distances.bag_centroid_vectorized import (
        BagCentroidCache,
        precompute_bag_cache,
    )
except ImportError:
    BagCentroidCache = None  # type: ignore[assignment, misc]
    precompute_bag_cache = None  # type: ignore[assignment]

from miclustering.distances.distance_matrix import compute_distance_matrix
from miclustering.evaluation.bcm import MILEvaluator
from miclustering.evaluation.cvi import (
    DunnIndex,
    IIndex,
    InternalCVIEvaluator,
    SilhouetteIndex,
    VRCIndex,
)
from miclustering.models.cosmic import COSMIC
from miclustering.models.midbscan import MIDBSCAN
from miclustering.models.mikmeans import MIKMeans
from miclustering.models.mikmedoids import MIKMedoids
from miclustering.preprocessing.scaler import MinMaxScaler, StandardScaler

# Configuración de registro estructurado
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("optimize_geometry")
optuna.logging.set_verbosity(optuna.logging.WARNING)

# Filtrado de advertencias numéricas benignas de subnormales/desbordamiento en BLAS
warnings.filterwarnings("ignore", category=RuntimeWarning, module=".*bag_centroid_vectorized.*")
warnings.filterwarnings("ignore", message=".*divide by zero encountered in matmul.*")
warnings.filterwarnings("ignore", message=".*overflow encountered in matmul.*")
warnings.filterwarnings("ignore", message=".*invalid value encountered in matmul.*")

# Registro de constructores de modelos
MODEL_REGISTRY: Dict[str, Any] = {
    "midbscan": MIDBSCAN,
    "mikmeans": MIKMeans,
    "mikmedoids": MIKMedoids,
    "cosmic": COSMIC,
}

# Modelos que admiten precomputed_matrix en fit()
SUPPORTS_PRECOMPUTED = {"midbscan", "mikmedoids", "cosmic"}

# Modelos con concepto explícito de ruido (multiobjetivo)
DENSITY_MODELS = {"midbscan", "cosmic"}


# 1. ÍNDICES DE VALIDACIÓN GEOMÉTRICA (CVIs)

# Instancias reutilizables de métricas CVI de miclustering.evaluation.cvi
_DUNN_CVI = DunnIndex()
_SILHOUETTE_CVI = SilhouetteIndex()
_VRC_CVI = VRCIndex()
_PBM_CVI = IIndex()


def normalize_dunn(dunn_raw: float, c: float) -> float:
    """Aplica la transformación monótona acotada Dunn' = Dunn / (Dunn + c).

    Garantiza Dunn' in [0, 1) sin requerir re-escalado dinámico min-max.

    Ref: work-flow.md, Sección 3.
    """
    if np.isinf(dunn_raw):
        return 1.0
    if dunn_raw <= 0.0 or c <= 0.0:
        return 0.0
    return float(dunn_raw / (dunn_raw + c))


# 2. EVALUACIÓN DE CLASIFICACIÓN SUPERVISADA (BCM VÍA ALGORITMO HÚNGARO)

def compute_bcm_metrics(
    y_true: np.ndarray,
    y_pred_clusters: np.ndarray,
) -> Dict[str, float]:
    """Mapea clusters a etiquetas reales con el Algoritmo Húngaro y calcula BCM.

    Retorna:
        Dict con 'precision', 'recall', 'f1_score', 'specificity'.
    """
    y_pred_mapped, _ = MILEvaluator.hungarian_map_clusters_to_labels(
        y_true, y_pred_clusters
    )

    prec = float(sk_metrics.precision_score(y_true, y_pred_mapped, zero_division=0))
    rec = float(sk_metrics.recall_score(y_true, y_pred_mapped, zero_division=0))
    f1 = float(sk_metrics.f1_score(y_true, y_pred_mapped, zero_division=0))

    try:
        tn, fp, fn, tp = confusion_matrix(y_true, y_pred_mapped, labels=[0, 1]).ravel()
        spec = float(tn / (tn + fp)) if (tn + fp) > 0 else 0.0
    except ValueError:
        spec = 0.0

    return {
        "precision": prec,
        "recall": rec,
        "f1_score": f1,
        "specificity": spec,
    }


# 3. CONTROL DE OPTUNA: EARLY STOPPING CALLBACK

class EarlyStoppingCallback:
    """Interrumpe la búsqueda en Optuna si no hay mejora tras N trials consecutivos."""

    def __init__(self, patience: int = 50) -> None:
        self.patience = patience
        self._best_metric: Optional[float] = None
        self._trials_without_improvement = 0

    def __call__(self, study: optuna.Study, trial: optuna.trial.FrozenTrial) -> None:
        if trial.state != optuna.trial.TrialState.COMPLETE:
            return

        improved = False
        is_multi = len(study.directions) > 1

        if is_multi:
            # En multiobjetivo: evaluamos la mejor distancia al punto utópico ideal (1.0, 0.0)
            best_trials = study.best_trials
            min_utopia_dist = float("inf")
            for t in best_trials:
                if t.values is not None and len(t.values) >= 2:
                    score, noise_pct = t.values[0], t.values[1]
                    dist = float(np.sqrt((1.0 - score) ** 2 + (noise_pct / 100.0) ** 2))
                    if dist < min_utopia_dist:
                        min_utopia_dist = dist

            if self._best_metric is None or min_utopia_dist < (self._best_metric - 1e-4):
                self._best_metric = min_utopia_dist
                improved = True
        else:
            val = trial.value
            if val is not None:
                if self._best_metric is None:
                    self._best_metric = val
                    improved = True
                elif study.direction == optuna.study.StudyDirection.MAXIMIZE:
                    if val > (self._best_metric + 1e-4):
                        self._best_metric = val
                        improved = True
                else:
                    if val < (self._best_metric - 1e-4):
                        self._best_metric = val
                        improved = True

        if improved:
            self._trials_without_improvement = 0
        else:
            self._trials_without_improvement += 1

        if self._trials_without_improvement >= self.patience:
            logger.info(
                f"[EarlyStopping] Detención temprana tras {self._trials_without_improvement} "
                f"trials consecutivos sin mejora."
            )
            study.stop()


# 4. ESPACIOS DE BÚSQUEDA Y FUNCIÓN OBJETIVO

def sample_hyperparameters(
    model_name: str,
    trial: optuna.Trial,
    upper_distances: np.ndarray,
    n_bags: int,
    seed: int,
    distance_name: str,
    max_iters: int = 100,
    tol: float = 0.01,
    device: str = "cpu",
) -> Dict[str, Any]:
    """Genera hiperparámetros muestreados para cada clase de modelo."""
    hp: Dict[str, Any] = {}

    if model_name == "midbscan":
        min_pts = trial.suggest_int("min_pts", 2, min(20, max(2, n_bags - 1)))
        eps_pct = trial.suggest_float("eps_percentile", 1.0, 50.0)
        epsilon = float(np.percentile(upper_distances, eps_pct))
        hp = {
            "min_pts": min_pts,
            "epsilon": epsilon,
            "metric": distance_name,
            "n_jobs": 1,
        }

    elif model_name == "cosmic":
        min_pts = trial.suggest_int("min_pts", 2, min(20, max(2, n_bags - 1)))
        eps_pct = trial.suggest_float("eps_percentile", 10.0, 70.0)
        epsilon = float(np.percentile(upper_distances, eps_pct))
        eps_prime_pct = trial.suggest_float("eps_prime_percentile", 1.0, eps_pct)
        epsilon_prime = float(np.percentile(upper_distances, eps_prime_pct))
        hp = {
            "min_pts": min_pts,
            "epsilon": epsilon,
            "epsilon_prime": epsilon_prime,
            "metric": distance_name,
            "n_jobs": 1,
        }

    elif model_name == "mikmeans":
        max_k = min(15, max(2, n_bags - 1))
        k = trial.suggest_int("k", 2, max_k)
        hp = {
            "k": k,
            "metric": distance_name,
            "max_iters": max_iters,
            "tol": tol,
            "random_state": seed,
            "device": device,
            "n_jobs": 1,
        }

    elif model_name == "mikmedoids":
        max_k = min(15, max(2, n_bags - 1))
        k = trial.suggest_int("k", 2, max_k)
        hp = {
            "k": k,
            "metric": distance_name,
            "max_iters": max_iters,
            "random_state": seed,
            "device": device,
            "n_jobs": 1,
        }

    return hp


def create_objective(
    model_name: str,
    dataset: MIData,
    dist_matrix: np.ndarray,
    c_median: float,
    X_centroids: np.ndarray,
    y_true: np.ndarray,
    upper_distances: np.ndarray,
    seed: int,
    distance_name: str,
    dist_matrix_time: float,
    bag_cache: Optional[Any] = None,
    max_iters: int = 100,
    tol: float = 0.01,
    device: str = "cpu",
    n_jobs: int = 1,
) -> Callable[[optuna.Trial], Any]:
    """Construye la función objetivo para un modelo particular."""
    is_multi_objective = model_name in DENSITY_MODELS
    ModelClass = MODEL_REGISTRY[model_name]
    n_bags = dataset.get_num_bags()
    bag_ids = [b.bag_id for b in dataset.bags]

    def objective(trial: optuna.Trial) -> Any:
        trial_t0 = time.perf_counter()

        # Registro del tiempo de cómputo de la matriz compartida
        trial.set_user_attr("dist_matrix_time", dist_matrix_time)

        # Muestreo de hiperparámetros
        hp = sample_hyperparameters(
            model_name,
            trial,
            upper_distances,
            n_bags,
            seed,
            distance_name,
            max_iters=max_iters,
            tol=tol,
            device=device,
        )

        for k_param, v_param in hp.items():
            if not isinstance(v_param, (int, float, str, bool)):
                continue
            trial.set_user_attr(f"hp_{k_param}", v_param)

        model = ModelClass(**hp)

        # 1. Ajuste del modelo
        fit_t0 = time.perf_counter()
        if model_name in SUPPORTS_PRECOMPUTED:
            model.fit(dataset, precomputed_matrix=dist_matrix)
        elif model_name == "mikmeans":
            fit_kwargs: Dict[str, Any] = {}
            fit_params = inspect.signature(model.fit).parameters
            if "bag_cache" in fit_params and bag_cache is not None:
                fit_kwargs["bag_cache"] = bag_cache
            if "precomputed_matrix" in fit_params:
                fit_kwargs["precomputed_matrix"] = dist_matrix
            model.fit(dataset, **fit_kwargs)
            # Telemetría de auditoría: permite comprobar en el CSV, sin grepear
            # logs, si esta combinación usó de verdad las distancias vectorizadas.
            trial.set_user_attr("bag_cache_applied", "bag_cache" in fit_kwargs)
        else:
            model.fit(dataset)
        fit_time = time.perf_counter() - fit_t0
        trial.set_user_attr("fit_time", fit_time)

        # Registro de telemetría de iteraciones si el modelo la expone
        n_iter = getattr(model, "n_iter_", None)
        if n_iter is not None:
            trial.set_user_attr("n_iter", int(n_iter))

        # Extracción de etiquetas y máscara de exclusión de ruido
        labels = model.labels_
        noise_label = getattr(model, "NOISE_LABEL", -1)
        mask = labels != noise_label if noise_label is not None else np.ones_like(labels, dtype=bool)

        n_noise = int(np.sum(~mask))
        noise_pct = float(100.0 * n_noise / len(labels)) if len(labels) > 0 else 0.0
        unique_clusters = np.unique(labels[mask])
        n_clusters = len(unique_clusters)

        # Guarda contra casos degenerados
        if n_clusters < 2:
            trial.set_user_attr("degenerate", True)
            trial.set_user_attr("n_clusters", n_clusters)
            trial.set_user_attr("n_iter", int(n_iter) if n_iter is not None else 0)
            trial.set_user_attr("noise_pct", noise_pct)
            trial.set_user_attr("silhouette_raw", -1.0)
            trial.set_user_attr("dunn_raw", 0.0)
            trial.set_user_attr("dunn_norm", 0.0)
            trial.set_user_attr("score", -1.0)
            trial.set_user_attr("vrc", 0.0)
            trial.set_user_attr("pbm", 0.0)
            trial.set_user_attr("precision", 0.0)
            trial.set_user_attr("recall", 0.0)
            trial.set_user_attr("f1_score", 0.0)
            trial.set_user_attr("specificity", 0.0)
            trial.set_user_attr("silhouette_time", 0.0)
            trial.set_user_attr("dunn_time", 0.0)
            trial.set_user_attr("cvi_time", 0.0)
            trial.set_user_attr("bcm_time", 0.0)
            trial.set_user_attr("trial_total_time", time.perf_counter() - trial_t0)

            if is_multi_objective:
                return -1.0, 100.0
            return -1.0

        trial.set_user_attr("degenerate", False)
        trial.set_user_attr("n_clusters", n_clusters)
        trial.set_user_attr("noise_pct", noise_pct)

        # 2. Cómputo de CVIs utilizando miclustering.evaluation.cvi
        cvi_t0 = time.perf_counter()

        labels_dict = model.labels

        sil_t0 = time.perf_counter()
        sil = _SILHOUETTE_CVI.compute(dist_matrix, labels_dict, bag_ids)
        sil_time = time.perf_counter() - sil_t0

        dunn_t0 = time.perf_counter()
        dunn_raw = _DUNN_CVI.compute(dist_matrix, labels_dict, bag_ids)
        dunn_norm = normalize_dunn(dunn_raw, c_median)
        dunn_time = time.perf_counter() - dunn_t0

        vrc = _VRC_CVI.compute(dist_matrix, labels_dict, bag_ids, X=X_centroids)
        pbm = _PBM_CVI.compute(dist_matrix, labels_dict, bag_ids, X=X_centroids)

        cvi_total_time = time.perf_counter() - cvi_t0

        score = float(0.5 * sil + 0.5 * dunn_norm)

        trial.set_user_attr("silhouette_raw", sil)
        trial.set_user_attr("dunn_raw", dunn_raw)
        trial.set_user_attr("dunn_norm", dunn_norm)
        trial.set_user_attr("score", score)
        trial.set_user_attr("vrc", vrc)
        trial.set_user_attr("pbm", pbm)
        trial.set_user_attr("silhouette_time", sil_time)
        trial.set_user_attr("dunn_time", dunn_time)
        trial.set_user_attr("cvi_time", cvi_total_time)

        # 3. Cómputo de Métricas BCM
        bcm_t0 = time.perf_counter()
        bcm_metrics = compute_bcm_metrics(y_true, labels)
        bcm_time = time.perf_counter() - bcm_t0

        trial.set_user_attr("precision", bcm_metrics["precision"])
        trial.set_user_attr("recall", bcm_metrics["recall"])
        trial.set_user_attr("f1_score", bcm_metrics["f1_score"])
        trial.set_user_attr("specificity", bcm_metrics["specificity"])
        trial.set_user_attr("bcm_time", bcm_time)

        trial.set_user_attr("trial_total_time", time.perf_counter() - trial_t0)

        if is_multi_objective:
            return score, noise_pct
        return score

    return objective


# 5. ORQUESTACIÓN Y EJECUCIÓN EXPERIMENTAL

def select_best_trial(study: optuna.Study) -> optuna.trial.FrozenTrial:
    """Selecciona el mejor trial representativo para reporte tabular."""
    if len(study.directions) <= 1:
        return study.best_trial

    pareto_trials = study.best_trials
    if not pareto_trials:
        # Fallback si no hay trials completos
        completed = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]
        return completed[0] if completed else study.trials[0]

    # Criterio: Distancia euclídea mínima al punto utópico ideal (score=1.0, ruido=0%)
    best_t = pareto_trials[0]
    min_dist = float("inf")

    for t in pareto_trials:
        if t.values is None or len(t.values) < 2:
            continue
        # Descartar casos marcados como degenerados si existen opciones válidas
        if t.user_attrs.get("degenerate", False) and len(pareto_trials) > 1:
            continue
        score, noise_pct = t.values[0], t.values[1]
        dist = float(np.sqrt((1.0 - score) ** 2 + (noise_pct / 100.0) ** 2))
        if dist < min_dist:
            min_dist = dist
            best_t = t

    return best_t


def run_experiment(
    data_dir: Path,
    output_dir: Path,
    cache_dir: Optional[Path] = None,
    datasets_filter: Optional[List[str]] = None,
    scalers_filter: Optional[List[Optional[str]]] = None,
    distances_filter: Optional[List[str]] = None,
    models_filter: Optional[List[str]] = None,
    n_trials: int = 50,
    patience: int = 50,
    density_n_trials: Optional[int] = None,
    density_patience: Optional[int] = None,
    timeout: Optional[float] = None,
    seed: int = 42,
    n_jobs: int = 1,
    device: str = "cpu",
    max_iters: int = 100,
    tol: float = 0.01,
) -> pd.DataFrame:
    """Ejecuta el protocolo experimental completo y genera las tablas de síntesis."""
    output_dir.mkdir(parents=True, exist_ok=True)
    summary_dir = output_dir / "resumen"
    summary_dir.mkdir(parents=True, exist_ok=True)
    by_dataset_dir = output_dir / "por_dataset"
    by_dataset_dir.mkdir(parents=True, exist_ok=True)
    by_model_dir = output_dir / "por_modelo"
    by_model_dir.mkdir(parents=True, exist_ok=True)
    trials_dir = output_dir / "trials"
    trials_dir.mkdir(parents=True, exist_ok=True)
    if cache_dir is not None:
        cache_dir = Path(cache_dir).resolve()

    # 1. Resolución de datasets (.arff)
    arff_files = sorted(list(data_dir.glob("*.arff")))
    if not arff_files:
        raise FileNotFoundError(f"No se encontraron archivos .arff en {data_dir.resolve()}")

    if datasets_filter:
        arff_files = [f for f in arff_files if f.stem in datasets_filter]
        if not arff_files:
            raise ValueError(f"Ningún archivo coincide con el filtro: {datasets_filter}")

    # 2. Resolución de factores experimentales
    available_scalers: Dict[str, Optional[Any]] = {
        "MinMaxScaler": MinMaxScaler,
        "StandardScaler": StandardScaler,
        "none": None,
    }
    if scalers_filter:
        scalers_to_run = {k: available_scalers[k] for k in scalers_filter if k in available_scalers}
    else:
        scalers_to_run = {
            "MinMaxScaler": MinMaxScaler,
            "StandardScaler": StandardScaler,
        }

    if distances_filter:
        distances_to_run = [d for d in distances_filter if d in DISTANCE_REGISTRY]
    else:
        distances_to_run = [
            "cauchy_schwarz",
            "earth_movers",
            "hausdorff",
            "hausdorff_avg",
            "hausdorff_min",
            "mahalanobis",
        ]

    if models_filter:
        models_to_run = [m for m in models_filter if m in MODEL_REGISTRY]
    else:
        models_to_run = ["midbscan", "mikmeans", "mikmedoids", "cosmic"]

    eff_density_trials = density_n_trials if density_n_trials is not None else min(n_trials, 50)
    eff_density_patience = density_patience if density_patience is not None else min(patience, 30)

    logger.info(
        f"Configuración experimental inicializada: {len(arff_files)} datasets, "
        f"{len(scalers_to_run)} escaladores, {len(distances_to_run)} distancias, "
        f"{len(models_to_run)} modelos. "
        f"Presupuesto: {n_trials} trials (patience={patience}) [particionales], "
        f"{eff_density_trials} trials (patience={eff_density_patience}) [densidad: midbscan/cosmic]."
    )

    consolidated_results: List[Dict[str, Any]] = []

    #  BUCLE EXTERIOR: dataset -> scaler -> distance 
    for arff_path in arff_files:
        raw_dataset = MIData.from_arff(str(arff_path))
        dataset_name = raw_dataset.name
        y_true = np.array([parse_label(b.label) for b in raw_dataset.bags])

        logger.info(f"== Dataset: {dataset_name} ({raw_dataset.get_num_bags()} bolsas) ==")

        for scaler_name, ScalerClass in scalers_to_run.items():
            if ScalerClass is not None:
                scaler_inst = ScalerClass()
                dataset_scaled = scaler_inst.fit_transform(raw_dataset)
            else:
                dataset_scaled = raw_dataset

            # Centroides X calculados 1 sola vez por escalador vía InternalCVIEvaluator
            scaled_bag_ids = [b.bag_id for b in dataset_scaled.bags]
            X_centroids = InternalCVIEvaluator._compute_bag_centroids(
                dataset_scaled, scaled_bag_ids
            )

            for distance_name in distances_to_run:
                metric_func = DISTANCE_REGISTRY.get(distance_name)

                # Resolución o cómputo de matriz de distancias (1 SOLA VEZ)
                cache_file = (
                    cache_dir / f"{dataset_name}_{scaler_name}_{distance_name}.npy"
                    if cache_dir is not None
                    else None
                )

                dist_matrix = None
                dist_matrix_time = 0.0

                if cache_file is not None and cache_file.is_file():
                    mat_t0 = time.perf_counter()
                    dist_matrix = np.load(cache_file)
                    dist_matrix_time = time.perf_counter() - mat_t0
                    n_expected = dataset_scaled.get_num_bags()
                    if dist_matrix.shape != (n_expected, n_expected):
                        raise ValueError(
                            f"Dimensión de matriz en caché {cache_file.name} ({dist_matrix.shape}) "
                            f"no coincide con el número esperado de bolsas ({n_expected}, {n_expected})."
                        )
                    logger.info(
                        f"Matriz de distancias cargada desde caché: {cache_file.name} "
                        f"({dist_matrix.shape[0]}×{dist_matrix.shape[1]}) en {dist_matrix_time:.4f} s."
                    )
                else:
                    if metric_func is None:
                        raise ValueError(
                            f"Métrica '{distance_name}' no encontrada en DISTANCE_REGISTRY ni en caché."
                        )
                    logger.info(
                        f"Calculando matriz N×N: dataset={dataset_name}, scaler={scaler_name}, "
                        f"distance={distance_name}..."
                    )
                    mat_t0 = time.perf_counter()
                    dist_matrix = compute_distance_matrix(
                        dataset_scaled.bags,
                        metric_func,
                        distance_name,
                        n_jobs=n_jobs,
                        device=device,
                    )
                    dist_matrix_time = time.perf_counter() - mat_t0
                    logger.info(
                        f"Matriz N×N calculada en {dist_matrix_time:.2f} s."
                    )
                    if cache_dir is not None:
                        cache_dir.mkdir(parents=True, exist_ok=True)
                        save_path = cache_dir / f"{dataset_name}_{scaler_name}_{distance_name}.npy"
                        np.save(save_path, dist_matrix)
                        logger.info(f"Matriz de distancias persistida en caché: {save_path.name}")

                # Distancias triangulares superiores (excluyendo diagonal)
                upper_tri_indices = np.triu_indices_from(dist_matrix, k=1)
                upper_distances = dist_matrix[upper_tri_indices]
                upper_pos = upper_distances[upper_distances > 0]
                if len(upper_pos) == 0:
                    upper_pos = np.array([1.0], dtype=np.float64)

                c_median = float(np.median(upper_pos))
                if c_median < 1e-15:
                    c_median = 1.0

                # Precomputación O(1) de estructuras vectorizadas para MIKMeans si aplica
                bag_cache = None
                if "mikmeans" in models_to_run and precompute_bag_cache is not None:
                    try:
                        t_cache_0 = time.perf_counter()
                        bag_cache = precompute_bag_cache(dataset_scaled.bags, distance_name)
                        cache_elapsed = time.perf_counter() - t_cache_0
                        logger.info(
                            f"BagCentroidCache precomputado para {dataset_name}/{scaler_name}/{distance_name} "
                            f"en {cache_elapsed * 1000:.2f} ms."
                        )
                    except Exception as exc:
                        logger.warning(
                            f"No se pudo precomputar BagCentroidCache para "
                            f"{dataset_name}/{scaler_name}/{distance_name} ({exc}). "
                            f"MIKMeans usará el bucle Python por trial (más lento) en esta combinación."
                        )
                        bag_cache = None

                #  BUCLE INTERIOR: modelos 
                for model_name in models_to_run:
                    is_multi = model_name in DENSITY_MODELS
                    study_name = f"{dataset_name}__{scaler_name}__{distance_name}__{model_name}"

                    if is_multi:
                        study = optuna.create_study(
                            study_name=study_name,
                            directions=["maximize", "minimize"],
                            sampler=optuna.samplers.TPESampler(seed=seed),
                        )
                    else:
                        study = optuna.create_study(
                            study_name=study_name,
                            direction="maximize",
                            sampler=optuna.samplers.TPESampler(seed=seed),
                        )

                    objective_fn = create_objective(
                        model_name=model_name,
                        dataset=dataset_scaled,
                        dist_matrix=dist_matrix,
                        c_median=c_median,
                        X_centroids=X_centroids,
                        y_true=y_true,
                        upper_distances=upper_pos,
                        seed=seed,
                        distance_name=distance_name,
                        dist_matrix_time=dist_matrix_time,
                        bag_cache=bag_cache,
                        max_iters=max_iters,
                        tol=tol,
                        device=device,
                        n_jobs=n_jobs,
                    )

                    is_density = model_name in DENSITY_MODELS
                    cur_trials = (
                        density_n_trials
                        if density_n_trials is not None
                        else min(n_trials, 50)
                    ) if is_density else n_trials
                    cur_patience = (
                        density_patience
                        if density_patience is not None
                        else min(patience, 30)
                    ) if is_density else patience

                    early_stop_cb = EarlyStoppingCallback(patience=cur_patience)

                    logger.info(
                        f"Iniciando estudio Optuna: {model_name} "
                        f"(multiobjetivo={is_multi}, n_trials={cur_trials}, patience={cur_patience})..."
                    )
                    study_t0 = time.perf_counter()
                    study.optimize(
                        objective_fn,
                        n_trials=cur_trials,
                        timeout=timeout,
                        callbacks=[early_stop_cb],
                        n_jobs=1,
                    )
                    study_wall_time = time.perf_counter() - study_t0

                    # Persistir trials detallados a CSV
                    trials_df = study.trials_dataframe()
                    trials_df["study_wall_time"] = study_wall_time
                    # Persistir trials detallados estructurados por dataset y modelo
                    model_trials_dir = trials_dir / dataset_name / model_name
                    model_trials_dir.mkdir(parents=True, exist_ok=True)
                    trial_csv_path = model_trials_dir / f"{scaler_name}__{distance_name}.csv"
                    trials_df.to_csv(trial_csv_path, index=False)

                    # Seleccionar mejor trial
                    best_trial = select_best_trial(study)
                    u_attrs = best_trial.user_attrs

                    summary_entry = {
                        "dataset": dataset_name,
                        "scaler": scaler_name,
                        "distance": distance_name,
                        "model": model_name,
                        "trial_number": best_trial.number,
                        "score": u_attrs.get("score", -1.0),
                        "silhouette_raw": u_attrs.get("silhouette_raw", -1.0),
                        "dunn_raw": u_attrs.get("dunn_raw", 0.0),
                        "dunn_norm": u_attrs.get("dunn_norm", 0.0),
                        "noise_pct": u_attrs.get("noise_pct", 0.0),
                        "n_clusters": u_attrs.get("n_clusters", 0),
                        "n_iter": u_attrs.get("n_iter", None),
                        "vrc": u_attrs.get("vrc", 0.0),
                        "pbm": u_attrs.get("pbm", 0.0),
                        "precision": u_attrs.get("precision", 0.0),
                        "recall": u_attrs.get("recall", 0.0),
                        "f1_score": u_attrs.get("f1_score", 0.0),
                        "specificity": u_attrs.get("specificity", 0.0),
                        "dist_matrix_time": dist_matrix_time,
                        "fit_time": u_attrs.get("fit_time", 0.0),
                        "cvi_time": u_attrs.get("cvi_time", 0.0),
                        "bcm_time": u_attrs.get("bcm_time", 0.0),
                        "trial_total_time": u_attrs.get("trial_total_time", 0.0),
                        "study_wall_time": study_wall_time,
                        "total_trials_evaluated": len(study.trials),
                        "degenerate": u_attrs.get("degenerate", False),
                        "bag_cache_applied": u_attrs.get("bag_cache_applied", None),
                        "best_params": str(best_trial.params),
                    }
                    consolidated_results.append(summary_entry)

    # 3. Consolidación y exportación de resultados maestros
    master_df = pd.DataFrame(consolidated_results)
    if not master_df.empty:
        # Archivo maestro completo en raíz y en resumen/
        master_csv_path = output_dir / "resultados_optimizacion_geometria.csv"
        summary_master_path = summary_dir / "resultados_optimizacion_geometria.csv"
        master_df.to_csv(master_csv_path, index=False)
        master_df.to_csv(summary_master_path, index=False)
        logger.info(f"Resultados consolidados guardados en: {master_csv_path}")

        # 4. Tablas comparativas globales (dataset x modelo)
        pivot_score = master_df.pivot_table(
            index="dataset",
            columns="model",
            values="score",
            aggfunc="max",
        )
        pivot_f1 = master_df.pivot_table(
            index="dataset",
            columns="model",
            values="f1_score",
            aggfunc="max",
        )
        pivot_score.to_csv(summary_dir / "comparativa_modelos_score.csv")
        pivot_f1.to_csv(summary_dir / "comparativa_modelos_f1.csv")
        pivot_score.to_csv(output_dir / "comparativa_modelos_score.csv")
        pivot_f1.to_csv(output_dir / "comparativa_modelos_f1.csv")

        # Ranking de mejores configuraciones globales (dataset x modelo)
        best_configs = (
            master_df.sort_values(by="score", ascending=False)
            .groupby(["dataset", "model"], as_index=False)
            .first()
        )
        best_configs.to_csv(summary_dir / "mejores_configuraciones.csv", index=False)

        # 5. Organización y desagregación por dataset
        for d_name, d_group in master_df.groupby("dataset"):
            ds_dir = by_dataset_dir / str(d_name)
            ds_dir.mkdir(parents=True, exist_ok=True)
            d_group.sort_values(by="score", ascending=False).to_csv(
                ds_dir / f"resumen_{d_name}.csv", index=False
            )
            best_in_ds = (
                d_group.sort_values(by="score", ascending=False)
                .groupby("model", as_index=False)
                .first()
            )
            best_in_ds.to_csv(ds_dir / f"mejores_modelos_{d_name}.csv", index=False)

        # 6. Organización y desagregación por modelo
        for m_name, m_group in master_df.groupby("model"):
            m_dir = by_model_dir / str(m_name)
            m_dir.mkdir(parents=True, exist_ok=True)
            m_group.sort_values(by="score", ascending=False).to_csv(
                m_dir / f"resumen_{m_name}.csv", index=False
            )
            best_in_m = (
                m_group.sort_values(by="score", ascending=False)
                .groupby("dataset", as_index=False)
                .first()
            )
            best_in_m.to_csv(m_dir / f"mejores_por_dataset_{m_name}.csv", index=False)

        logger.info(
            f"Estructura de resultados generada exitosamente en '{output_dir}': "
            f"resumen/, por_dataset/, por_modelo/, trials/."
        )

    return master_df


# 6. ENTRADA PRINCIPAL (CLI)

def build_parser() -> argparse.ArgumentParser:
    """Configura y retorna el parser de argumentos de línea de comandos."""
    parser = argparse.ArgumentParser(
        description="Optimización de hiperparámetros basada en geometría (CVIs) para modelos MIL."
    )
    parser.add_argument(
        "--data-dir",
        type=str,
        default="data",
        help="Directorio que contiene los archivos .arff (por defecto 'data').",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="resultados_geometria",
        help="Directorio de destino para reportes y CSVs de resultados.",
    )
    parser.add_argument(
        "--cache-dir",
        type=str,
        default="cache",
        help="Directorio con matrices de distancias precomputadas (.npy). Por defecto 'cache'.",
    )
    parser.add_argument(
        "--datasets",
        nargs="+",
        default=None,
        help="Nombres de datasets a evaluar (sin extensión .arff). Si no se especifica, procesa todos.",
    )
    parser.add_argument(
        "--scalers",
        nargs="+",
        default=None,
        choices=["MinMaxScaler", "StandardScaler", "none"],
        help="Escaladores a evaluar. Por defecto evalúa los precalculados (MinMaxScaler, StandardScaler).",
    )
    parser.add_argument(
        "--distances",
        nargs="+",
        default=None,
        help="Métricas de distancia a evaluar (ej. cauchy_schwarz, earth_movers, hausdorff, hausdorff_avg, hausdorff_min, mahalanobis).",
    )
    parser.add_argument(
        "--models",
        nargs="+",
        default=None,
        choices=["midbscan", "mikmeans", "mikmedoids", "cosmic"],
        help="Modelos a optimizar. Por defecto evalúa los cuatro.",
    )
    parser.add_argument(
        "--n-trials",
        type=int,
        default=50,
        help="Número máximo de trials de Optuna por estudio (por defecto 50).",
    )
    parser.add_argument(
        "--patience",
        type=int,
        default=50,
        help="Trials consecutivos sin mejora antes de detener el estudio (por defecto 50).",
    )
    parser.add_argument(
        "--density-n-trials",
        "--density-max-iter",
        dest="density_n_trials",
        type=int,
        default=None,
        help="Número máximo de trials/iteraciones para modelos de densidad (midbscan, cosmic). Por defecto min(n_trials, 50).",
    )
    parser.add_argument(
        "--density-patience",
        type=int,
        default=None,
        help="Trials consecutivos sin mejora para modelos de densidad (midbscan, cosmic). Por defecto min(patience, 30).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=None,
        help="Tiempo límite en segundos por estudio de Optuna.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Semilla pseudoaleatoria para reproducibilidad (por defecto 42).",
    )
    parser.add_argument(
        "--n-jobs",
        type=int,
        default=-1,
        help="Número de procesos paralelos para cómputo de matrices (-1 para todos los cores).",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cpu",
        choices=["cpu", "cuda", "mps", "auto"],
        help="Dispositivo de cómputo para cálculo de distancias.",
    )
    parser.add_argument(
        "--max-iters",
        type=int,
        default=100,
        help="Número máximo de iteraciones para modelos iterativos (MIKMeans, MIKMedoids). Por defecto 100.",
    )
    parser.add_argument(
        "--tol",
        type=float,
        default=0.01,
        help="Tolerancia de convergencia relativa para MIKMeans (fracción de bolsas cambiadas). Por defecto 0.01.",
    )
    return parser


def main() -> None:
    """Función de entrada para ejecución como script."""
    parser = build_parser()
    args = parser.parse_args()

    data_path = Path(args.data_dir).resolve()
    out_path = Path(args.output_dir).resolve()
    cache_path = (
        Path(args.cache_dir).resolve()
        if args.cache_dir and args.cache_dir.lower() != "none"
        else None
    )

    logger.info("Iniciando pipeline de optimización geométrica.")
    if cache_path is not None and cache_path.is_dir():
        logger.info(f"Directorio de caché de distancias precomputadas activo: {cache_path}")
    t_start = time.perf_counter()

    try:
        results_df = run_experiment(
            data_dir=data_path,
            output_dir=out_path,
            cache_dir=cache_path,
            datasets_filter=args.datasets,
            scalers_filter=args.scalers,
            distances_filter=args.distances,
            models_filter=args.models,
            n_trials=args.n_trials,
            patience=args.patience,
            density_n_trials=args.density_n_trials,
            density_patience=args.density_patience,
            timeout=args.timeout,
            seed=args.seed,
            n_jobs=args.n_jobs,
            device=args.device,
            max_iters=args.max_iters,
            tol=args.tol,
        )
        total_elapsed = time.perf_counter() - t_start
        logger.info(
            f"Pipeline completado con éxito en {total_elapsed:.2f} s. "
            f"Estudios registrados: {len(results_df)}."
        )
    except Exception as exc:
        logger.exception(f"Error fatal durante la ejecución del pipeline: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()