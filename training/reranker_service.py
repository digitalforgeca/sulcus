#!/usr/bin/env python3
"""
Sulcus Cross-Encoder Reranker Service (Task 92)

Lightweight HTTP server that loads ms-marco-MiniLM-L-6-v2 once on startup
and scores (query, document) pairs on demand.

Listen address: localhost:3091 (avoids port conflicts with the main server on 3000)
API:
  POST /rerank
    Body: {"query": str, "candidates": [{"id": str, "text": str}]}
    Returns: {"scores": [{"id": str, "score": float}], "ranked": true}

  GET /health
    Returns: {"status": "ok", "model": "..."}

Usage:
  python3 reranker_service.py [--port 3091] [--model cross-encoder/ms-marco-MiniLM-L-6-v2]
"""
import json
import sys
import logging
import argparse
import signal
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import List, Dict

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s reranker %(levelname)s %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("reranker")


def load_model(model_name: str):
    """Load cross-encoder model. Returns the CrossEncoder instance."""
    try:
        from sentence_transformers import CrossEncoder
        log.info(f"Loading cross-encoder: {model_name}")
        model = CrossEncoder(model_name, max_length=512)
        log.info(f"Model loaded: {model_name}")
        return model
    except ImportError as e:
        log.error(f"sentence-transformers not available: {e}")
        raise
    except Exception as e:
        log.error(f"Failed to load model {model_name}: {e}")
        raise


class RerankerHandler(BaseHTTPRequestHandler):
    """Request handler for the reranker HTTP service."""

    model = None  # Set at startup by main()
    model_name = ""

    def log_message(self, fmt, *args):
        # Suppress access log spam; errors still go to stderr via log
        pass

    def send_json(self, data: dict, status: int = 200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json({
                "status": "ok",
                "model": self.model_name,
                "ready": self.model is not None,
            })
        else:
            self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/rerank":
            self.send_json({"error": "not found"}, 404)
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            req = json.loads(body)
        except Exception as e:
            self.send_json({"error": f"bad request: {e}"}, 400)
            return

        query = req.get("query", "")
        candidates: List[Dict] = req.get("candidates", [])

        if not query or not candidates:
            self.send_json({"error": "missing query or candidates"}, 400)
            return

        if self.model is None:
            self.send_json({"error": "model not ready"}, 503)
            return

        try:
            # Build (query, doc) pairs for the cross-encoder
            pairs = [(query, c["text"]) for c in candidates]

            # Score all pairs in one batched forward pass
            raw_scores = self.model.predict(pairs, batch_size=32, show_progress_bar=False)

            # Return scores paired with IDs, in original order
            # (Rust side will re-sort)
            scores = [
                {"id": candidates[i]["id"], "score": float(raw_scores[i])}
                for i in range(len(candidates))
            ]

            self.send_json({"scores": scores, "ranked": True})

        except Exception as e:
            log.error(f"Rerank error: {e}")
            self.send_json({"error": str(e)}, 500)


def main():
    parser = argparse.ArgumentParser(description="Sulcus cross-encoder reranker service")
    parser.add_argument("--port", type=int, default=3091, help="Listen port (default: 3091)")
    parser.add_argument(
        "--model",
        default="cross-encoder/ms-marco-MiniLM-L-6-v2",
        help="HuggingFace cross-encoder model ID",
    )
    args = parser.parse_args()

    # Load model before starting server
    try:
        model = load_model(args.model)
    except Exception as e:
        log.error(f"Cannot start reranker service: {e}")
        sys.exit(1)

    # Inject into handler class
    RerankerHandler.model = model
    RerankerHandler.model_name = args.model

    server = HTTPServer(("127.0.0.1", args.port), RerankerHandler)

    # Clean shutdown on SIGTERM (Container App sends SIGTERM on scale-in)
    def _shutdown(sig, frame):
        log.info("SIGTERM received — shutting down reranker service")
        server.shutdown()

    signal.signal(signal.SIGTERM, _shutdown)

    log.info(f"Reranker service listening on 127.0.0.1:{args.port} (model: {args.model})")

    # Signal to parent process that we're ready (write to stdout)
    print("READY", flush=True)

    server.serve_forever()


if __name__ == "__main__":
    main()
