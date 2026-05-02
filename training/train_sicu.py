#!/usr/bin/env python3
"""
Train the SI Classification Unit (SICU) — memory type classifier.

Architecture: TfidfVectorizer → SGDClassifier (multi-class, class_weight='balanced')
Evaluation: 5-fold cross-validation, then train on full train set
Export: ONNX via skl2onnx for Rust inference

Multi-class classification: episodic / semantic / preference / procedural / fact

Usage:
    python train_sicu.py [--train sicu_training_train.jsonl] [--test sicu_training_test.jsonl]
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


EXPECTED_CLASSES = ["episodic", "fact", "preference", "procedural", "semantic"]


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
    parser = argparse.ArgumentParser(description="Train SICU memory type classifier")
    parser.add_argument("--train", default="sicu_training_train.jsonl", help="Training data")
    parser.add_argument("--test", default="sicu_training_test.jsonl", help="Test data")
    parser.add_argument("--output", default="sicu_model.onnx", help="ONNX output path")
    parser.add_argument("--cv-folds", type=int, default=5, help="Cross-validation folds")
    parser.add_argument("--max-features", type=int, default=30000, help="TF-IDF max features")
    parser.add_argument("--ngram-max", type=int, default=2, help="Max n-gram range")
    parser.add_argument("--alpha", type=float, default=1e-4, help="SGD regularization")
    args = parser.parse_args()

    print("=" * 60, file=sys.stderr)
    print("SICU Training — SI Classification Unit (Memory Type)", file=sys.stderr)
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
    print(f"\nTrain distribution:", file=sys.stderr)
    for label in EXPECTED_CLASSES:
        print(f"  {label}: {train_dist.get(label, 0)} ({train_dist.get(label, 0)/len(y_train)*100:.1f}%)", file=sys.stderr)
    print(f"\nTest distribution:", file=sys.stderr)
    for label in EXPECTED_CLASSES:
        print(f"  {label}: {test_dist.get(label, 0)} ({test_dist.get(label, 0)/len(y_test)*100:.1f}%)", file=sys.stderr)

    # Verify all expected classes present
    present_classes = set(y_train) | set(y_test)
    missing = set(EXPECTED_CLASSES) - present_classes
    if missing:
        print(f"\n⚠️ Missing classes: {missing}", file=sys.stderr)
    unexpected = present_classes - set(EXPECTED_CLASSES)
    if unexpected:
        print(f"\n⚠️ Unexpected classes: {unexpected}", file=sys.stderr)

    # Build pipeline
    # Using SGDClassifier with 'modified_huber' for probability estimates
    # class_weight='balanced' handles imbalanced classes (preference: 6%, semantic: 9%)
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
            class_weight="balanced",  # critical for imbalanced classes
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

    # Also compute macro F1 via CV
    cv_f1 = cross_val_score(pipeline, X_train, y_train, cv=cv, scoring="f1_macro", n_jobs=-1)
    print(f"  CV macro F1: {cv_f1.mean():.4f} ± {cv_f1.std():.4f}", file=sys.stderr)

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
    report = classification_report(y_test, y_pred, labels=EXPECTED_CLASSES, digits=4)
    print(report, file=sys.stderr)

    print(f"Confusion Matrix:", file=sys.stderr)
    cm = confusion_matrix(y_test, y_pred, labels=EXPECTED_CLASSES)
    print(f"  Labels: {EXPECTED_CLASSES}", file=sys.stderr)
    for i, label in enumerate(EXPECTED_CLASSES):
        print(f"  {label:12s}: {cm[i]}", file=sys.stderr)

    # Target checks
    print(f"\n--- Target Checks ---", file=sys.stderr)
    per_class = classification_report(y_test, y_pred, labels=EXPECTED_CLASSES, output_dict=True)
    
    overall_accuracy = accuracy
    print(f"  Overall accuracy: {overall_accuracy:.4f} (target: >0.90) {'✅' if overall_accuracy > 0.90 else '⚠️'}", file=sys.stderr)
    
    all_f1_pass = True
    for label in EXPECTED_CLASSES:
        f1 = per_class.get(label, {}).get("f1-score", 0)
        passed = f1 > 0.85
        if not passed:
            all_f1_pass = False
        print(f"  {label:12s} F1: {f1:.4f} (target: >0.85) {'✅' if passed else '⚠️'}", file=sys.stderr)

    macro_f1 = per_class.get("macro avg", {}).get("f1-score", 0)
    print(f"  Macro F1:       {macro_f1:.4f}", file=sys.stderr)

    # Export to ONNX
    print(f"\nExporting to ONNX: {args.output}", file=sys.stderr)
    try:
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
    print(f"SICU training complete.", file=sys.stderr)
    print(f"{'=' * 60}", file=sys.stderr)


if __name__ == "__main__":
    main()
