#!/usr/bin/env python3
"""
train_situ.py — Train the SI Trigger Unit (SITU)

SITU evaluates whether a trigger should fire given a memory event + context.
Input: event description + context JSON
Output: fire/no_fire binary classification + confidence

Training data sources:
1. trigger_log (actual trigger fires) → positive examples
2. trigger_feedback (false_positive/false_negative/correct) → corrections
3. Synthetic negative examples from memories that didn't trigger anything

Architecture: same as SIVU — TF-IDF + SGDClassifier → ONNX
The text input is: "{event_type}: {memory_text} [context: {trigger_conditions}]"

Usage:
    python train_situ.py --data situ_training_data.jsonl --output models/base/
    python train_situ.py --export-from-api --api-url https://api.sulcus.ca --api-key YOUR_KEY

Requires: scikit-learn>=1.8, skl2onnx>=1.20, onnx>=1.21
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import SGDClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report, confusion_matrix


def load_training_data(path: str) -> tuple[list[str], list[str]]:
    """Load JSONL training data.
    
    Expected format per line:
    {
        "text": "memory_created: Dooley prefers dark mode [trigger: condition=heat>0.8, action=notify]",
        "label": "fire" | "no_fire"
    }
    """
    texts, labels = [], []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            texts.append(row["text"])
            labels.append(row["label"])
    return texts, labels


def build_situ_text(event_type: str, memory_text: str, trigger_conditions: str = "") -> str:
    """Format input text for SITU model.
    
    Standardizes the input format so the model sees consistent patterns.
    """
    base = f"{event_type}: {memory_text}"
    if trigger_conditions:
        base += f" [trigger: {trigger_conditions}]"
    return base


def export_from_api(api_url: str, api_key: str, output_path: str):
    """Export training data from Sulcus API.
    
    Combines:
    - trigger_log (fires) → positive examples
    - trigger_feedback (corrections) → labeled corrections  
    - Recent memories without triggers → synthetic negatives
    """
    import requests
    
    headers = {"Authorization": f"Bearer {api_key}"}
    
    # Get trigger fire history
    fires_resp = requests.get(f"{api_url}/api/v1/triggers/history", headers=headers)
    fires = fires_resp.json().get("history", []) if fires_resp.ok else []
    
    # Get trigger feedback
    feedback_resp = requests.get(f"{api_url}/api/v1/triggers/feedback?limit=200", headers=headers)
    feedback = feedback_resp.json().get("feedback", []) if feedback_resp.ok else []
    
    training_data = []
    
    # Fires → positive examples (unless feedback says false_positive)
    false_positive_log_ids = {
        f["trigger_log_id"] for f in feedback 
        if f.get("feedback_type") == "false_positive" and f.get("trigger_log_id")
    }
    
    for fire in fires:
        log_id = fire.get("id", "")
        if log_id in false_positive_log_ids:
            # This was a false positive — label as no_fire
            text = build_situ_text(
                fire.get("event", "unknown"),
                fire.get("node_id", ""),
                f"action={fire.get('action', '')}"
            )
            training_data.append({"text": text, "label": "no_fire"})
        else:
            # Actual correct fire
            text = build_situ_text(
                fire.get("event", "unknown"),
                fire.get("node_id", ""),
                f"action={fire.get('action', '')}"
            )
            training_data.append({"text": text, "label": "fire"})
    
    # False negatives → should have fired
    for fb in feedback:
        if fb.get("feedback_type") == "false_negative":
            text = build_situ_text(
                fb.get("event_type", "unknown"),
                fb.get("notes", ""),
                f"expected={fb.get('expected_action', 'fire')}"
            )
            training_data.append({"text": text, "label": "fire"})
    
    with open(output_path, "w") as f:
        for item in training_data:
            f.write(json.dumps(item) + "\n")
    
    print(f"Exported {len(training_data)} training examples to {output_path}")
    return training_data


def train(texts: list[str], labels: list[str], output_dir: str):
    """Train SITU model and export to ONNX."""
    
    print(f"\nTraining SITU on {len(texts)} examples")
    print(f"  fire: {labels.count('fire')}, no_fire: {labels.count('no_fire')}")
    
    if len(texts) < 20:
        print("WARNING: Very small training set. Model quality will be poor.")
        print("Minimum recommended: 200 examples (100 fire + 100 no_fire)")
    
    # Build pipeline
    pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(
            max_features=10000,
            ngram_range=(1, 2),
            sublinear_tf=True,
            min_df=2,
            max_df=0.95,
        )),
        ("clf", SGDClassifier(
            loss="modified_huber",  # Gives probability estimates
            class_weight="balanced",
            max_iter=1000,
            random_state=42,
            alpha=1e-4,
        )),
    ])
    
    X = np.array(texts)
    y = np.array(labels)
    
    # Cross-validation if enough data
    if len(texts) >= 50:
        n_splits = min(5, min(labels.count("fire"), labels.count("no_fire")))
        if n_splits >= 2:
            cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)
            scores = cross_val_score(pipeline, X, y, cv=cv, scoring="accuracy")
            print(f"\n{n_splits}-fold CV accuracy: {scores.mean():.4f} ± {scores.std():.4f}")
    
    # Train on full dataset
    pipeline.fit(X, y)
    
    # Evaluate on training set (will overfit, but shows model is learning)
    y_pred = pipeline.predict(X)
    print("\nTraining set report:")
    print(classification_report(y, y_pred))
    print("Confusion matrix:")
    print(confusion_matrix(y, y_pred))
    
    # Export to ONNX
    try:
        from skl2onnx import convert_sklearn
        from skl2onnx.common.data_types import StringTensorType
        
        onnx_model = convert_sklearn(
            pipeline,
            "situ_model",
            initial_types=[("text", StringTensorType([None, 1]))],
            target_opset=12,
        )
        
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        onnx_path = output_path / "situ_model.onnx"
        with open(onnx_path, "wb") as f:
            f.write(onnx_model.SerializeToString())
        
        # Save labels
        labels_path = output_path / "situ_model_labels.json"
        unique_labels = sorted(set(labels))
        label_map = {str(i): l for i, l in enumerate(unique_labels)}
        with open(labels_path, "w") as f:
            json.dump(label_map, f, indent=2)
        
        # Save manifest
        manifest = {
            "model": "situ",
            "version": "v0.1",
            "architecture": "tfidf_sgd",
            "training_samples": len(texts),
            "fire_samples": labels.count("fire"),
            "no_fire_samples": labels.count("no_fire"),
            "labels": label_map,
            "onnx_size_bytes": onnx_path.stat().st_size,
        }
        with open(output_path / "situ_manifest.json", "w") as f:
            json.dump(manifest, f, indent=2)
        
        print(f"\nModel saved to {onnx_path} ({onnx_path.stat().st_size:,} bytes)")
        print(f"Labels saved to {labels_path}")
        
    except ImportError:
        print("\nskl2onnx not installed — skipping ONNX export")
        print("Install with: pip install skl2onnx")


def main():
    parser = argparse.ArgumentParser(description="Train SITU (SI Trigger Unit)")
    parser.add_argument("--data", help="Path to JSONL training data")
    parser.add_argument("--output", default="models/base/", help="Output directory for ONNX model")
    parser.add_argument("--export-from-api", action="store_true", help="Export training data from API")
    parser.add_argument("--api-url", default="https://api.sulcus.ca", help="Sulcus API URL")
    parser.add_argument("--api-key", help="API key for export")
    parser.add_argument("--export-output", default="situ_training_data.jsonl", help="Path for exported data")
    args = parser.parse_args()
    
    if args.export_from_api:
        if not args.api_key:
            print("ERROR: --api-key required for API export")
            sys.exit(1)
        data = export_from_api(args.api_url, args.api_key, args.export_output)
        if not data:
            print("No training data found. Need trigger fires + feedback first.")
            sys.exit(0)
        texts = [d["text"] for d in data]
        labels = [d["label"] for d in data]
    elif args.data:
        texts, labels = load_training_data(args.data)
    else:
        print("ERROR: specify --data or --export-from-api")
        sys.exit(1)
    
    if len(texts) < 10:
        print(f"Only {len(texts)} examples — too few to train. Need at least 10.")
        sys.exit(0)
    
    train(texts, labels, args.output)


if __name__ == "__main__":
    main()
