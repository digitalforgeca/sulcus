#!/usr/bin/env python3
"""
Train the SI Value Unit (SIVU) — binary quality gate classifier.

Architecture: TfidfVectorizer → SGDClassifier (log loss, hinge)
Evaluation: 5-fold cross-validation, then train on full train set
Export: ONNX via skl2onnx for Rust inference

Binary classification: "store" vs "reject"

Usage:
    python train_sivu.py [--train sivu_training_train.jsonl] [--test sivu_training_test.jsonl]
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
    """Load JSONL and return (texts, labels)."""
    texts, labels = [], []
    with open(path) as f:
        for line in f:
            if line.strip():
                rec = json.loads(line)
                texts.append(rec["text"])
                labels.append(rec["label"])
    return texts, labels


def main():
    parser = argparse.ArgumentParser(description="Train SIVU quality gate classifier")
    parser.add_argument("--train", default="sivu_training_train.jsonl", help="Training data")
    parser.add_argument("--test", default="sivu_training_test.jsonl", help="Test data")
    parser.add_argument("--output", default="sivu_model.onnx", help="ONNX output path")
    parser.add_argument("--cv-folds", type=int, default=5, help="Cross-validation folds")
    parser.add_argument("--max-features", type=int, default=30000, help="TF-IDF max features")
    parser.add_argument("--ngram-max", type=int, default=2, help="Max n-gram range")
    parser.add_argument("--alpha", type=float, default=1e-4, help="SGD regularization")
    args = parser.parse_args()

    print("=" * 60, file=sys.stderr)
    print("SIVU Training — SI Value Unit (Store/Reject)", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    # Load data
    print(f"\nLoading training data: {args.train}", file=sys.stderr)
    X_train, y_train = load_jsonl(args.train)
    print(f"  {len(X_train)} samples", file=sys.stderr)

    print(f"Loading test data: {args.test}", file=sys.stderr)
    X_test, y_test = load_jsonl(args.test)
    print(f"  {len(X_test)} samples", file=sys.stderr)

    # Label distribution
    from collections import Counter
    train_dist = Counter(y_train)
    test_dist = Counter(y_test)
    print(f"\nTrain distribution: {dict(train_dist)}", file=sys.stderr)
    print(f"Test distribution:  {dict(test_dist)}", file=sys.stderr)

    # Build pipeline
    pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(
            max_features=args.max_features,
            ngram_range=(1, args.ngram_max),
            sublinear_tf=True,
            strip_accents=None,  # "unicode" not supported by skl2onnx
            min_df=2,
        )),
        ("clf", SGDClassifier(
            loss="modified_huber",  # provides probability estimates
            alpha=args.alpha,
            max_iter=1000,
            class_weight="balanced",
            random_state=42,
            n_jobs=-1,
        )),
    ])

    # Cross-validation
    print(f"\n{args.cv_folds}-fold cross-validation...", file=sys.stderr)
    cv = StratifiedKFold(n_splits=args.cv_folds, shuffle=True, random_state=42)
    cv_scores = cross_val_score(pipeline, X_train, y_train, cv=cv, scoring="accuracy", n_jobs=-1)
    print(f"  CV accuracy: {cv_scores.mean():.4f} ± {cv_scores.std():.4f}", file=sys.stderr)
    print(f"  Per-fold: {[f'{s:.4f}' for s in cv_scores]}", file=sys.stderr)

    # Train on full training set
    print(f"\nTraining on full training set ({len(X_train)} samples)...", file=sys.stderr)
    t0 = time.time()
    pipeline.fit(X_train, y_train)
    train_time = time.time() - t0
    print(f"  Training time: {train_time:.2f}s", file=sys.stderr)

    # Evaluate on test set
    print(f"\nTest set evaluation ({len(X_test)} samples):", file=sys.stderr)
    y_pred = pipeline.predict(X_test)
    accuracy = np.mean(np.array(y_pred) == np.array(y_test))
    print(f"  Accuracy: {accuracy:.4f}", file=sys.stderr)

    print(f"\nClassification Report:", file=sys.stderr)
    report = classification_report(y_test, y_pred, digits=4)
    print(report, file=sys.stderr)

    print(f"Confusion Matrix:", file=sys.stderr)
    labels = sorted(set(y_test))
    cm = confusion_matrix(y_test, y_pred, labels=labels)
    print(f"  Labels: {labels}", file=sys.stderr)
    print(f"  {cm}", file=sys.stderr)

    # Target checks
    print(f"\n--- Target Checks ---", file=sys.stderr)
    per_class = classification_report(y_test, y_pred, output_dict=True)
    reject_precision = per_class.get("reject", {}).get("precision", 0)
    reject_recall = per_class.get("reject", {}).get("recall", 0)
    store_recall = per_class.get("store", {}).get("recall", 0)
    print(f"  Reject precision: {reject_precision:.4f} (target: >0.95) {'✅' if reject_precision > 0.95 else '⚠️'}", file=sys.stderr)
    print(f"  Reject recall:    {reject_recall:.4f}", file=sys.stderr)
    print(f"  Store recall:     {store_recall:.4f} (target: >0.90) {'✅' if store_recall > 0.90 else '⚠️'}", file=sys.stderr)

    # Export to ONNX
    print(f"\nExporting to ONNX: {args.output}", file=sys.stderr)
    try:
        # skl2onnx needs the initial type for string input
        initial_type = [("text", StringTensorType([None, 1]))]
        onnx_model = to_onnx(pipeline, initial_types=initial_type)
        
        with open(args.output, "wb") as f:
            f.write(onnx_model.SerializeToString())
        
        import os
        size_kb = os.path.getsize(args.output) / 1024
        print(f"  ONNX model size: {size_kb:.1f} KB", file=sys.stderr)
        print(f"  ✅ ONNX export successful", file=sys.stderr)
    except Exception as e:
        print(f"  ⚠️ ONNX export failed: {e}", file=sys.stderr)
        print(f"  Saving sklearn model as fallback...", file=sys.stderr)
        import pickle
        fallback = args.output.replace(".onnx", ".pkl")
        with open(fallback, "wb") as f:
            pickle.dump(pipeline, f)
        print(f"  Saved as {fallback}", file=sys.stderr)

    # Save label map
    label_map_path = args.output.replace(".onnx", "_labels.json")
    label_map = {i: label for i, label in enumerate(pipeline.classes_)}
    with open(label_map_path, "w") as f:
        json.dump(label_map, f, indent=2)
    print(f"  Label map: {label_map_path} → {label_map}", file=sys.stderr)

    # Save TF-IDF vocabulary size
    vocab_size = len(pipeline.named_steps["tfidf"].vocabulary_)
    print(f"  TF-IDF vocabulary: {vocab_size} terms", file=sys.stderr)

    print(f"\n{'=' * 60}", file=sys.stderr)
    print(f"SIVU training complete.", file=sys.stderr)
    print(f"{'=' * 60}", file=sys.stderr)


if __name__ == "__main__":
    main()
