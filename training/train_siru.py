#!/usr/bin/env python3
"""
train_siru.py — Train the SI Recall Unit (SIRU)

SIRU evaluates whether a memory candidate should be included in recall context,
summarized, or dropped — given a query and the candidate's metadata.

Input: "{query_text} ||| {memory_label} ||| {memory_type} ||| {source_signal} ||| {heat}"
Output: multi-class (include/summarize/drop) + confidence

Training data sources:
1. recall_sessions table — which memories were selected and their scores
2. recall_log + feedback signals — was_useful / relevant / irrelevant
3. Synthetic examples bootstrapped from high/low-heat memory pairs

Architecture: same as SIVU/SICU — TF-IDF + SGDClassifier → ONNX
Future: graduate to a small transformer once we have 10K+ examples.

Usage:
    python train_siru.py [--train siru_training_train.jsonl] [--test siru_training_test.jsonl]
"""

import argparse
import json
import sys
import time
import numpy as np

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import SGDClassifier
from sklearn.pipeline import Pipeline
from sklearn.model_selection import cross_val_score, StratifiedKFold
from sklearn.metrics import classification_report, confusion_matrix
from skl2onnx import to_onnx
from skl2onnx.common.data_types import StringTensorType


def load_jsonl(path: str) -> tuple[list[str], list[str]]:
    """Load JSONL and return (texts, labels).
    
    Expected format:
    {"text": "query ||| memory_label ||| memory_type ||| source ||| heat", "label": "include|summarize|drop"}
    """
    texts, labels = [], []
    with open(path) as f:
        for line in f:
            if line.strip():
                rec = json.loads(line)
                texts.append(rec["text"])
                labels.append(rec["label"])
    return texts, labels


def main():
    parser = argparse.ArgumentParser(description="Train SIRU recall intelligence classifier")
    parser.add_argument("--train", default="siru_training_train.jsonl", help="Training data")
    parser.add_argument("--test", default="siru_training_test.jsonl", help="Test data")
    parser.add_argument("--output", default="siru_model.onnx", help="ONNX output path")
    parser.add_argument("--labels-output", default="siru_model_labels.json", help="Labels JSON output path")
    parser.add_argument("--cv-folds", type=int, default=5, help="Cross-validation folds")
    parser.add_argument("--max-features", type=int, default=30000, help="TF-IDF max features")
    parser.add_argument("--ngram-max", type=int, default=2, help="Max n-gram range")
    parser.add_argument("--alpha", type=float, default=1e-4, help="SGD regularization")
    args = parser.parse_args()

    print("=" * 60, file=sys.stderr)
    print("SIRU Training — SI Recall Unit (Include/Summarize/Drop)", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    # Load data
    print(f"\nLoading training data: {args.train}", file=sys.stderr)
    X_train, y_train = load_jsonl(args.train)
    print(f"  {len(X_train)} samples", file=sys.stderr)
    
    label_counts = {}
    for label in y_train:
        label_counts[label] = label_counts.get(label, 0) + 1
    print(f"  Distribution: {label_counts}", file=sys.stderr)

    # Pipeline: TF-IDF → SGD
    pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(
            max_features=args.max_features,
            ngram_range=(1, args.ngram_max),
            sublinear_tf=True,
            strip_accents="unicode",
        )),
        ("clf", SGDClassifier(
            loss="modified_huber",  # supports probability estimates
            alpha=args.alpha,
            max_iter=1000,
            class_weight="balanced",
            random_state=42,
        )),
    ])

    # Cross-validation
    n_folds = min(args.cv_folds, min(label_counts.values()))
    if n_folds >= 2:
        print(f"\n{n_folds}-fold cross-validation:", file=sys.stderr)
        skf = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=42)
        cv_scores = cross_val_score(pipeline, X_train, y_train, cv=skf, scoring="accuracy")
        print(f"  Accuracy: {cv_scores.mean():.3f} ± {cv_scores.std():.3f}", file=sys.stderr)
    else:
        print(f"\nSkipping CV (not enough samples per class, min={min(label_counts.values())})", file=sys.stderr)

    # Train on full training set
    print("\nTraining on full training set...", file=sys.stderr)
    t0 = time.time()
    pipeline.fit(X_train, y_train)
    print(f"  Training took {time.time() - t0:.2f}s", file=sys.stderr)

    # Evaluate on test set
    print(f"\nLoading test data: {args.test}", file=sys.stderr)
    X_test, y_test = load_jsonl(args.test)
    print(f"  {len(X_test)} samples", file=sys.stderr)

    y_pred = pipeline.predict(X_test)
    print("\nClassification Report:", file=sys.stderr)
    print(classification_report(y_test, y_pred), file=sys.stderr)
    print("Confusion Matrix:", file=sys.stderr)
    print(confusion_matrix(y_test, y_pred), file=sys.stderr)

    # Export to ONNX
    print(f"\nExporting to ONNX: {args.output}", file=sys.stderr)
    labels = sorted(set(y_train + y_test))
    onnx_model = to_onnx(
        pipeline,
        initial_types=[("text", StringTensorType([None]))],
        target_opset={"": 17, "ai.onnx.ml": 3},
    )
    with open(args.output, "wb") as f:
        f.write(onnx_model.SerializeToString())
    
    # Save labels
    with open(args.labels_output, "w") as f:
        json.dump(labels, f)
    
    print(f"  Labels: {labels}", file=sys.stderr)
    print(f"  Model size: {len(onnx_model.SerializeToString()) / 1024:.1f} KB", file=sys.stderr)
    print(f"\n✅ SIRU model exported successfully", file=sys.stderr)


if __name__ == "__main__":
    main()
