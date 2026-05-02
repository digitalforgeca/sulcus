#!/usr/bin/env python3
"""
Sulcus Memory Type Classifier — Inference Script
Author: Digital Forge Studios

Usage:
    python classify.py "I deployed the server at 3pm today."
    python classify.py --interactive
    python classify.py --batch input.txt

Output: JSON with label, confidence, and all class probabilities.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent
MODEL_DIR = ROOT / "model"
ONNX_PATH = MODEL_DIR / "memory_classifier.onnx"
LABEL_MAP_PATH = MODEL_DIR / "label_map.json"
MODEL_CONFIG_PATH = MODEL_DIR / "model_config.json"
TOKENIZER_DIR = MODEL_DIR / "tokenizer"


class SulcusClassifier:
    """
    Lightweight on-device Sulcus memory type classifier.

    Architecture:
        Input text → sentence-transformer embedding (MiniLM-L6-v2, 384-dim)
        → StandardScaler → Logistic Regression → softmax probabilities
        → argmax → label

    Latency: ~8-12ms end-to-end on modern laptop CPU (cold-start excluded).
    """

    LABELS = ["episodic", "semantic", "preference", "procedural", "synthesis"]
    CONFIDENCE_THRESHOLD = 0.70  # below this, flag for human review

    def __init__(self, model_dir: Path = MODEL_DIR):
        self.model_dir = model_dir
        self._session = None
        self._embed_model = None
        self._label_map = None
        self._model_config = None
        self._loaded = False

    def _load(self):
        """Lazy-load all model artifacts on first inference call."""
        if self._loaded:
            return

        # Load ONNX classifier
        try:
            import onnxruntime as rt
        except ImportError:
            raise ImportError("Install onnxruntime: pip install onnxruntime")

        onnx_path = self.model_dir / "memory_classifier.onnx"
        if not onnx_path.exists():
            raise FileNotFoundError(
                f"ONNX model not found at {onnx_path}. "
                f"Run train.py first to generate the model."
            )

        # Use CPU provider for portability
        self._session = rt.InferenceSession(
            str(onnx_path),
            providers=["CPUExecutionProvider"],
        )
        self._input_name = self._session.get_inputs()[0].name

        # Load label map
        with open(self.model_dir / "label_map.json") as f:
            raw_map = json.load(f)
        # Keys are strings in JSON, convert to int
        self._label_map = {int(k): v for k, v in raw_map.items()}

        # Load model config (embedding model name, etc.)
        config_path = self.model_dir / "model_config.json"
        if config_path.exists():
            with open(config_path) as f:
                self._model_config = json.load(f)
        else:
            self._model_config = {"model_name": "all-MiniLM-L6-v2"}

        # Load embedding model (sentence-transformers)
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError:
            raise ImportError(
                "Install sentence-transformers: pip install sentence-transformers"
            )

        model_name = self._model_config.get("model_name", "all-MiniLM-L6-v2")
        self._embed_model = SentenceTransformer(model_name)

        self._loaded = True

    def _embed(self, text: str) -> np.ndarray:
        """Embed a single text string to a float32 numpy array."""
        embedding = self._embed_model.encode(
            [text],
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return embedding.astype(np.float32)

    def classify(self, text: str) -> dict:
        """
        Classify a text into one of 5 memory types.

        Returns:
            {
                "label": str,           # predicted memory type
                "confidence": float,    # probability of the predicted class
                "probabilities": dict,  # all class probabilities
                "review_needed": bool,  # True if confidence < threshold
                "latency_ms": float,    # end-to-end latency
            }
        """
        self._load()

        text = text.strip()
        if not text:
            raise ValueError("Input text cannot be empty")
        if len(text) > 4096:
            text = text[:4096]  # truncate silently

        t0 = time.perf_counter()

        # 1. Embed
        embedding = self._embed(text)

        # 2. Run ONNX classifier
        outputs = self._session.run(None, {self._input_name: embedding})

        # outputs[0] = predicted class index
        # outputs[1] = dict of class probabilities (from skl2onnx)
        pred_idx = int(outputs[0][0])
        label = self._label_map[pred_idx]

        # Extract probabilities
        if len(outputs) > 1 and isinstance(outputs[1], list):
            # skl2onnx returns probabilities as a list of dicts
            prob_dict = outputs[1][0]
            probs = {self._label_map[int(k)]: float(v) for k, v in prob_dict.items()}
        else:
            # Fallback: uniform distribution
            probs = {lbl: 1.0 / 5 for lbl in self.LABELS}

        confidence = probs.get(label, 0.0)
        latency_ms = (time.perf_counter() - t0) * 1000

        return {
            "label": label,
            "confidence": round(confidence, 4),
            "probabilities": {k: round(v, 4) for k, v in sorted(probs.items())},
            "review_needed": confidence < self.CONFIDENCE_THRESHOLD,
            "latency_ms": round(latency_ms, 2),
        }

    def classify_batch(self, texts: list[str]) -> list[dict]:
        """Classify multiple texts. More efficient than calling classify() in a loop."""
        self._load()

        if not texts:
            return []

        # Batch embed for efficiency
        t0 = time.perf_counter()
        embeddings = self._embed_model.encode(
            texts,
            normalize_embeddings=True,
            batch_size=32,
            show_progress_bar=False,
        ).astype(np.float32)
        embed_ms = (time.perf_counter() - t0) * 1000

        results = []
        for i, embedding in enumerate(embeddings):
            inp = embedding.reshape(1, -1)
            t1 = time.perf_counter()
            outputs = self._session.run(None, {self._input_name: inp})
            infer_ms = (time.perf_counter() - t1) * 1000

            pred_idx = int(outputs[0][0])
            label = self._label_map[pred_idx]

            if len(outputs) > 1 and isinstance(outputs[1], list):
                prob_dict = outputs[1][0]
                probs = {
                    self._label_map[int(k)]: float(v) for k, v in prob_dict.items()
                }
            else:
                probs = {lbl: 1.0 / 5 for lbl in self.LABELS}

            confidence = probs.get(label, 0.0)

            results.append(
                {
                    "text": texts[i][:100] + "..." if len(texts[i]) > 100 else texts[i],
                    "label": label,
                    "confidence": round(confidence, 4),
                    "probabilities": {k: round(v, 4) for k, v in sorted(probs.items())},
                    "review_needed": confidence < self.CONFIDENCE_THRESHOLD,
                    "latency_ms": round(embed_ms / len(texts) + infer_ms, 2),
                }
            )

        return results


# ── CLI ────────────────────────────────────────────────────────────────────────

def format_result(result: dict, verbose: bool = False) -> str:
    """Format a classification result for terminal output."""
    label = result["label"]
    confidence = result["confidence"]
    review = " ⚠️  low confidence — review recommended" if result["review_needed"] else ""

    lines = [
        f"Label:      {label}{review}",
        f"Confidence: {confidence:.1%} ({result['latency_ms']:.1f}ms)",
    ]
    if verbose:
        lines.append("Probabilities:")
        for lbl, prob in sorted(result["probabilities"].items(), key=lambda x: -x[1]):
            bar = "█" * int(prob * 20)
            lines.append(f"  {lbl:<12} {prob:.1%}  {bar}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Sulcus memory type classifier",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python classify.py "I deployed the server at 3pm today."
  python classify.py --verbose "PostgreSQL default port is 5432."
  python classify.py --json "I prefer dark mode in all editors."
  python classify.py --interactive
  python classify.py --batch texts.txt --json
        """,
    )
    parser.add_argument("text", nargs="?", help="Text to classify")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show all class probabilities")
    parser.add_argument("--json", "-j", action="store_true", help="Output as JSON")
    parser.add_argument("--interactive", "-i", action="store_true", help="Interactive REPL mode")
    parser.add_argument("--batch", "-b", help="Path to file with one text per line")
    parser.add_argument("--model-dir", default=str(MODEL_DIR), help="Path to model directory")
    parser.add_argument("--threshold", type=float, default=0.70, help="Confidence threshold for review flag")

    args = parser.parse_args()

    clf = SulcusClassifier(model_dir=Path(args.model_dir))
    clf.CONFIDENCE_THRESHOLD = args.threshold

    if args.interactive:
        print("Sulcus Memory Type Classifier — Interactive Mode")
        print("Type text and press Enter to classify. Ctrl+C to exit.\n")
        while True:
            try:
                text = input(">>> ").strip()
                if not text:
                    continue
                result = clf.classify(text)
                if args.json:
                    print(json.dumps(result, indent=2))
                else:
                    print(format_result(result, verbose=True))
                print()
            except KeyboardInterrupt:
                print("\nBye.")
                break

    elif args.batch:
        with open(args.batch) as f:
            texts = [line.strip() for line in f if line.strip()]
        results = clf.classify_batch(texts)
        if args.json:
            print(json.dumps(results, indent=2))
        else:
            for r in results:
                print(f"\n[{r['label'].upper()}] {r['text']}")
                print(f"  Confidence: {r['confidence']:.1%}  ({r['latency_ms']:.1f}ms)")

    elif args.text:
        result = clf.classify(args.text)
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(format_result(result, verbose=args.verbose))

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
