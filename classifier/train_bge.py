#!/usr/bin/env python3
"""
Sulcus Memory Type Classifier — BGE-small-en-v1.5 Training Script
Author: Digital Forge Studios

This version uses BAAI/bge-small-en-v1.5 for embeddings, matching the
sulcus-embed Rust crate which uses the fastembed crate with BGE-small-en-v1.5.

Approach:
  1. Load training_data.csv (6223 examples, 5 classes)
  2. Generate embeddings using fastembed (BAAI/bge-small-en-v1.5, 384-dim)
     Falls back to sentence-transformers if fastembed unavailable
  3. Train LogisticRegression (C=1.0, max_iter=1000)
  4. 80/20 stratified train/test split
  5. Export to ONNX at model/memory_classifier_bge.onnx
  6. Save label_map.json
"""

import csv
import json
import os
import random
import time
from pathlib import Path
from collections import Counter

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, StandardScaler

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent
DATA_PATH = ROOT / "training_data.csv"
MODEL_DIR = ROOT / "model"
MODEL_DIR.mkdir(exist_ok=True)

ONNX_PATH = MODEL_DIR / "memory_classifier_bge.onnx"
LABEL_MAP_PATH = MODEL_DIR / "label_map.json"

# ── Config ─────────────────────────────────────────────────────────────────────
EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
RANDOM_SEED = 42
TEST_SIZE = 0.20   # 80/20 split as requested
MAX_ITER = 1000
C = 1.0            # as requested
SOLVER = "lbfgs"
CLASS_WEIGHT = "balanced"

random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)


# ── Load Data ──────────────────────────────────────────────────────────────────
def load_data(path: Path) -> tuple[list[str], list[str]]:
    texts, labels = [], []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            text = row["text"].strip()
            label = row["label"].strip()
            if text and label:
                texts.append(text)
                labels.append(label)
    return texts, labels


# ── Embed ──────────────────────────────────────────────────────────────────────
def embed_texts(texts: list[str]) -> np.ndarray:
    """
    Generate embeddings using fastembed (preferred — matches sulcus-embed Rust crate).
    Falls back to sentence-transformers if fastembed unavailable.
    """
    # Try fastembed first (matches Rust sulcus-embed crate)
    try:
        from fastembed import TextEmbedding
        print(f"Using fastembed with model: {EMBEDDING_MODEL}")
        model = TextEmbedding(model_name=EMBEDDING_MODEL)
        print(f"Embedding {len(texts)} texts with fastembed...")
        t0 = time.perf_counter()
        embeddings = list(model.embed(texts))
        embeddings = np.array(embeddings, dtype=np.float32)
        elapsed = time.perf_counter() - t0
        print(f"Embedding took {elapsed:.1f}s ({len(texts)/elapsed:.0f} texts/sec)")
        print(f"Embedding shape: {embeddings.shape}")
        return embeddings

    except ImportError:
        print("fastembed not available, falling back to sentence-transformers...")

    # Fallback: sentence-transformers
    try:
        from sentence_transformers import SentenceTransformer
        print(f"Using sentence-transformers with model: {EMBEDDING_MODEL}")
        model = SentenceTransformer(EMBEDDING_MODEL)
        print(f"Embedding {len(texts)} texts with sentence-transformers...")
        t0 = time.perf_counter()
        embeddings = model.encode(
            texts,
            batch_size=64,
            show_progress_bar=True,
            normalize_embeddings=True,
        )
        elapsed = time.perf_counter() - t0
        print(f"Embedding took {elapsed:.1f}s ({len(texts)/elapsed:.0f} texts/sec)")
        print(f"Embedding shape: {embeddings.shape}")
        return embeddings.astype(np.float32)

    except ImportError:
        raise ImportError(
            "Neither fastembed nor sentence-transformers is installed. "
            "Run: pip install fastembed   OR   pip install sentence-transformers"
        )


# ── Train ──────────────────────────────────────────────────────────────────────
def train(X: np.ndarray, y_labels: list[str]):
    """Train logistic regression and return clf, le, X_test, y_test."""
    le = LabelEncoder()
    y_enc = le.fit_transform(y_labels)

    print(f"\nClass mapping: {dict(zip(le.classes_, le.transform(le.classes_)))}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y_enc,
        test_size=TEST_SIZE,
        random_state=RANDOM_SEED,
        stratify=y_enc,
    )
    print(f"Train: {len(X_train)} | Test: {len(X_test)}")

    clf = Pipeline([
        ("scaler", StandardScaler()),
        ("lr", LogisticRegression(
            C=C,
            max_iter=MAX_ITER,
            solver=SOLVER,
            class_weight=CLASS_WEIGHT,
            random_state=RANDOM_SEED,
        )),
    ])

    print(f"\nTraining LogisticRegression (C={C}, max_iter={MAX_ITER})...")
    t0 = time.perf_counter()
    clf.fit(X_train, y_train)
    elapsed = time.perf_counter() - t0
    print(f"Training took {elapsed:.2f}s")

    return clf, le, X_test, y_test


# ── Evaluate ───────────────────────────────────────────────────────────────────
def evaluate(clf, le, X_test, y_test):
    """Print accuracy, per-class F1, and confusion matrix. Returns accuracy."""
    y_pred = clf.predict(X_test)
    acc = accuracy_score(y_test, y_pred)

    print(f"\n{'='*60}")
    print(f"Test Accuracy: {acc:.4f} ({acc*100:.2f}%)")
    print(f"{'='*60}")
    print("\nPer-class metrics:")
    report = classification_report(
        y_test, y_pred,
        target_names=le.classes_,
        digits=4,
    )
    print(report)

    cm = confusion_matrix(y_test, y_pred)
    print("Confusion matrix (rows=actual, cols=predicted):")
    print(f"  Labels: {list(le.classes_)}")
    print(cm)

    return acc, report, cm


# ── Export ONNX ────────────────────────────────────────────────────────────────
def export_onnx(clf, le, n_features: int):
    """Export the trained pipeline to ONNX format."""
    from skl2onnx import convert_sklearn
    from skl2onnx.common.data_types import FloatTensorType

    print(f"\nExporting ONNX model to {ONNX_PATH}...")
    initial_type = [("float_input", FloatTensorType([None, n_features]))]
    onnx_model = convert_sklearn(clf, initial_types=initial_type, target_opset=17)

    with open(ONNX_PATH, "wb") as f:
        f.write(onnx_model.SerializeToString())

    size_kb = ONNX_PATH.stat().st_size / 1024
    print(f"ONNX model saved: {ONNX_PATH} ({size_kb:.1f} KB)")
    return size_kb


# ── Export Label Map ───────────────────────────────────────────────────────────
def export_label_map(le: LabelEncoder):
    """Save integer-to-label mapping as JSON."""
    label_map = {int(i): str(c) for i, c in enumerate(le.classes_)}
    with open(LABEL_MAP_PATH, "w") as f:
        json.dump(label_map, f, indent=2)
    print(f"Label map saved: {LABEL_MAP_PATH}")
    print(f"  {label_map}")
    return label_map


# ── Validate ONNX ──────────────────────────────────────────────────────────────
def validate_onnx(le, X_sample, y_sample):
    """Quick sanity check: ONNX predictions match sklearn predictions."""
    import onnxruntime as rt

    sess = rt.InferenceSession(str(ONNX_PATH), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name

    X_f32 = X_sample[:20].astype(np.float32)
    pred = sess.run(None, {input_name: X_f32})
    onnx_labels = np.array(pred[0])
    sklearn_labels = y_sample[:20]

    match = np.sum(onnx_labels == sklearn_labels)
    print(f"\nONNX validation: {match}/20 predictions match sklearn model")
    print(f"  Example predictions: {[le.classes_[p] for p in onnx_labels[:5]]}")
    print(f"  Expected labels:     {[le.classes_[p] for p in sklearn_labels[:5]]}")

    # Latency benchmark
    X_single = X_sample[:1].astype(np.float32)
    times = []
    for _ in range(100):
        t0 = time.perf_counter()
        sess.run(None, {input_name: X_single})
        times.append((time.perf_counter() - t0) * 1000)
    p50 = np.percentile(times, 50)
    p99 = np.percentile(times, 99)
    print(f"\nONNX inference latency (classifier step only):")
    print(f"  p50: {p50:.3f}ms  p99: {p99:.3f}ms")


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("Sulcus Memory Type Classifier — BGE-small-en-v1.5 Training")
    print("Author: Digital Forge Studios")
    print("=" * 60)

    # 1. Load data
    print(f"\nLoading data from {DATA_PATH}...")
    texts, labels = load_data(DATA_PATH)
    print(f"Loaded {len(texts)} examples")
    print(f"Class distribution: {dict(Counter(labels))}")

    # 2. Embed with BGE-small-en-v1.5
    embeddings = embed_texts(texts)

    # 3. Train
    clf, le, X_test, y_test = train(embeddings, labels)

    # 4. Evaluate
    acc, report, cm = evaluate(clf, le, X_test, y_test)

    # 5. Export
    size_kb = export_onnx(clf, le, embeddings.shape[1])
    label_map = export_label_map(le)

    # 6. Validate ONNX
    validate_onnx(le, X_test, y_test)

    print("\n✅ BGE Training complete!")
    print(f"   Model:     {ONNX_PATH}")
    print(f"   Size:      {size_kb:.1f} KB")
    print(f"   Accuracy:  {acc*100:.2f}%")
    print(f"   Label map: {LABEL_MAP_PATH}")
    print(f"   Embedding: {EMBEDDING_MODEL} (384-dim, matches sulcus-embed Rust crate)")

    return acc


if __name__ == "__main__":
    main()
