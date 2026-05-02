#!/usr/bin/env python3
"""
Sulcus Memory Type Classifier — Multi-Label BGE Training Script
Author: Digital Forge Studios

Multi-label version: each text can belong to MULTIPLE memory types.
Uses OneVsRestClassifier with LogisticRegression (independent sigmoid per class).

Labels in training_data.csv can be:
  - Single: "episodic"
  - Multi:  "episodic|procedural"  (pipe-separated)

Output ONNX model returns per-class probabilities, not a single argmax.
The host process applies a threshold (default 0.5) to determine which labels apply.

Approach:
  1. Load training_data.csv (supports single and multi-label rows)
  2. Generate embeddings using fastembed (BAAI/bge-small-en-v1.5, 384-dim)
  3. Train OneVsRestClassifier(LogisticRegression) — one binary classifier per class
  4. 80/20 stratified train/test split (using iterative stratification for multi-label)
  5. Export to ONNX at model/memory_classifier_multilabel.onnx
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
    f1_score,
    hamming_loss,
)
from sklearn.model_selection import train_test_split
from sklearn.multiclass import OneVsRestClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent
DATA_PATH = ROOT / "training_data.csv"
MULTI_DATA_PATH = ROOT / "training_data_multilabel.csv"
MODEL_DIR = ROOT / "model"
MODEL_DIR.mkdir(exist_ok=True)

ONNX_PATH = MODEL_DIR / "memory_classifier_multilabel.onnx"
LABEL_MAP_PATH = MODEL_DIR / "label_map.json"
# Also save single-label model for backward compat
ONNX_SINGLE_PATH = MODEL_DIR / "memory_classifier_bge.onnx"

# ── Config ─────────────────────────────────────────────────────────────────────
EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
RANDOM_SEED = 42
TEST_SIZE = 0.20
MAX_ITER = 1000
C = 1.0
SOLVER = "lbfgs"
CLASS_WEIGHT = "balanced"

# All known classes in canonical order
CLASSES = ["episodic", "preference", "procedural", "semantic", "synthesis"]
NUM_CLASSES = len(CLASSES)

random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)


# ── Load Data ──────────────────────────────────────────────────────────────────
def load_data(path: Path) -> tuple[list[str], np.ndarray]:
    """Load CSV with pipe-separated multi-labels. Returns texts and binary label matrix."""
    texts = []
    label_matrix = []

    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            text = row["text"].strip()
            label_str = row["label"].strip()
            if not text or not label_str:
                continue

            # Parse pipe-separated labels
            labels = [l.strip() for l in label_str.split("|")]
            # Build binary vector
            vec = [0] * NUM_CLASSES
            for label in labels:
                if label in CLASSES:
                    vec[CLASSES.index(label)] = 1
                else:
                    print(f"WARNING: Unknown label '{label}' in row: {text[:50]}...")

            if sum(vec) == 0:
                continue  # Skip rows with no valid labels

            texts.append(text)
            label_matrix.append(vec)

    return texts, np.array(label_matrix, dtype=np.float32)


# ── Embed ──────────────────────────────────────────────────────────────────────
def embed_texts(texts: list[str]) -> np.ndarray:
    """Generate embeddings using fastembed (BAAI/bge-small-en-v1.5, 384-dim)."""
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
        pass

    try:
        from sentence_transformers import SentenceTransformer
        print(f"Using sentence-transformers with model: {EMBEDDING_MODEL}")
        model = SentenceTransformer(EMBEDDING_MODEL)
        print(f"Embedding {len(texts)} texts with sentence-transformers...")
        t0 = time.perf_counter()
        embeddings = model.encode(texts, batch_size=64, show_progress_bar=True, normalize_embeddings=True)
        elapsed = time.perf_counter() - t0
        print(f"Embedding took {elapsed:.1f}s ({len(texts)/elapsed:.0f} texts/sec)")
        return embeddings.astype(np.float32)
    except ImportError:
        raise ImportError("Neither fastembed nor sentence-transformers installed.")


# ── Generate Multi-Label Training Data ─────────────────────────────────────────
def generate_multilabel_data():
    """
    Take existing single-label data and:
    1. Keep all single-label rows as-is
    2. Add explicit multi-label examples for common overlaps
    """
    print("Generating multi-label training data...")

    # Load existing single-label data
    texts_labels = []
    with open(DATA_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            text = row["text"].strip()
            label = row["label"].strip()
            if text and label and label in CLASSES:
                texts_labels.append((text, label))

    print(f"  Loaded {len(texts_labels)} single-label examples")

    # Multi-label synthetic examples — things that genuinely span categories
    multilabel_examples = [
        # episodic + synthesis
        ("After three months of A/B testing the landing page, the data clearly shows that testimonial-first layouts convert 2.3x better. We shipped the winning variant yesterday.", "episodic|synthesis"),
        ("Spent the whole weekend debugging the memory leak. Turns out the connection pool wasn't being drained on shutdown. The pattern: always close pools in a finally block, not just on success paths.", "episodic|synthesis"),
        ("Launched the beta yesterday with 50 users. After analyzing the first 24 hours of data, the key insight is that users who complete onboarding in under 3 minutes have 4x higher retention.", "episodic|synthesis"),
        ("Completed the competitor analysis this morning. The synthesis: we are the only product with thermodynamic decay. Everyone else treats memory as append-only. This is our moat.", "episodic|synthesis"),
        ("Finished the pricing experiment last quarter. The data shows freemium converts at 4.2% while free trial converts at 8.7%. We're switching to free trial for Q2.", "episodic|synthesis"),
        ("Reviewed all customer support tickets from January. The pattern is clear: 80% of issues stem from unclear onboarding. Redesigning the first-run experience should cut support volume in half.", "episodic|synthesis"),
        ("After running the MemBench suite against all competitors, the conclusion is clear: our recall accuracy beats Mem0 by 15% and Zep by 23% on long-horizon tasks.", "episodic|synthesis"),
        ("Shipped the Python SDK yesterday. Cross-referencing with the support logs, most integration questions were about async/sync compatibility — the sync wrapper we added should eliminate those.", "episodic|synthesis"),
        ("Deployed the new caching layer on Tuesday. Monitoring shows p99 latency dropped from 340ms to 45ms. The takeaway: cache at the embedding level, not the query level.", "episodic|synthesis"),
        ("Ran user interviews with 12 enterprise prospects this week. The synthesis: they care about audit trails and data residency more than features. Compliance is the unlock.", "episodic|synthesis"),

        # episodic + procedural
        ("Yesterday I set up the CI pipeline: first install dependencies with npm ci, then run lint, then run tests in parallel, then build the Docker image.", "episodic|procedural"),
        ("Figured out how to fix the CORS issue today: add the origin to the allowlist in the nginx config, reload nginx, then test with curl -I.", "episodic|procedural"),
        ("Finally got the database migration working. The trick is to run pg_dump first, apply the ALTER TABLE, then verify row counts match.", "episodic|procedural"),
        ("Set up Keycloak auth this morning. The process: create a realm, add a client with PKCE, configure redirect URIs, export the client secret to env vars.", "episodic|procedural"),
        ("Deployed Sulcus to Azure Container Apps today. Steps: build with cargo, docker build, tag and push to ACR, then az containerapp update with the new image.", "episodic|procedural"),
        ("Got the SIU classifier trained today. Process was: prepare CSV training data, generate BGE embeddings, train LogisticRegression, export to ONNX, validate predictions.", "episodic|procedural"),
        ("Resolved the DNS propagation issue last night. Had to: clear the local DNS cache, update the A record in OpenSRS, wait 10 minutes, then verify with dig.", "episodic|procedural"),
        ("Connected the Stripe webhook this afternoon. Steps: create endpoint in Stripe dashboard, copy the signing secret, add the route handler, verify with stripe trigger.", "episodic|procedural"),
        ("Migrated the database from SQLite to PostgreSQL today. Process: export with .dump, transform the SQL for PG syntax, import with psql, verify all tables and row counts.", "episodic|procedural"),
        ("Set up the monitoring stack yesterday. Install Prometheus, configure scrape targets, deploy Grafana, import the dashboard template, set up alerting rules.", "episodic|procedural"),

        # procedural + preference
        ("When deploying to production, always run the full test suite first, then deploy to staging, smoke test, and only then promote to production. Never skip staging.", "procedural|preference"),
        ("For database backups: use pg_dump with the --format=custom flag, compress with gzip, upload to S3. Always verify the backup can be restored before deleting the previous one.", "procedural|preference"),
        ("When writing commit messages, use conventional commits format: type(scope): description. Always include the ticket number. Never use vague messages like 'fix stuff'.", "procedural|preference"),
        ("To handle API errors: check the status code, parse the error body, log with full context including request ID. Always return structured errors, never raw strings.", "procedural|preference"),
        ("For code reviews: check correctness first, then readability, then performance. Always leave at least one positive comment. Never approve with unresolved security concerns.", "procedural|preference"),
        ("When setting up a new project: initialize git, add .gitignore, create README, set up linting. Always configure CI before writing any feature code.", "procedural|preference"),
        ("For incident response: acknowledge within 5 minutes, start a war room channel, assign an incident commander. Always do a blameless post-mortem within 48 hours.", "procedural|preference"),
        ("When writing tests: arrange the test data, act on the system under test, assert the expected outcome. Always test the error paths, not just the happy path.", "procedural|preference"),
        ("For API design: use plural nouns for collections, singular for items. Always version the API from day one. Never break backward compatibility without a deprecation period.", "procedural|preference"),
        ("When configuring logging: use structured JSON format, include correlation IDs, set appropriate log levels. Always log errors with stack traces, never swallow exceptions silently.", "procedural|preference"),

        # semantic + preference
        ("PostgreSQL supports JSONB columns for semi-structured data. Always prefer JSONB over JSON for indexing and querying.", "semantic|preference"),
        ("HKDF is a key derivation function based on HMAC. Always use a unique salt per derivation context.", "semantic|preference"),
        ("WebSocket provides full-duplex communication over a single TCP connection. Always implement heartbeat pings to detect stale connections.", "semantic|preference"),
        ("ONNX Runtime supports CPU and GPU execution providers. Always benchmark both before choosing — CPU often wins for small models.", "semantic|preference"),
        ("Rust's ownership system prevents data races at compile time. Always prefer owned types over raw pointers in FFI boundaries.", "semantic|preference"),
        ("Content-addressable storage uses the hash of the content as its identifier. Always verify integrity on read, not just on write.", "semantic|preference"),
        ("Rate limiting protects APIs from abuse and resource exhaustion. Always use sliding window over fixed window — it prevents burst spikes at boundaries.", "semantic|preference"),
        ("Embeddings are dense vector representations of text in high-dimensional space. Always normalize embeddings before computing cosine similarity.", "semantic|preference"),
        ("JWT tokens encode claims as JSON and are signed with HMAC or RSA. Always validate the signature and expiry before trusting claims.", "semantic|preference"),
        ("Container images are layered filesystems built from Dockerfiles. Always use multi-stage builds to minimize the final image size.", "semantic|preference"),

        # synthesis + preference
        ("After analyzing six months of deployment data, the conclusion is clear: trunk-based development with feature flags produces fewer incidents than long-lived branches. Always merge to main daily.", "synthesis|preference"),
        ("Cross-referencing our support tickets with churn data reveals that response time matters more than resolution quality. Always acknowledge within 1 hour, even if the fix takes longer.", "synthesis|preference"),
        ("The pricing experiment data is conclusive: annual plans retain 3x better than monthly. Always default the pricing page to annual with a monthly toggle.", "synthesis|preference"),
        ("Reviewing all our production incidents from Q1: 70% were caused by missing input validation. Always validate at the API boundary, never trust downstream systems to handle bad data.", "synthesis|preference"),
        ("The A/B test on onboarding flows shows that interactive tutorials retain 2x better than video walkthroughs. Always favor learning-by-doing over passive content.", "synthesis|preference"),

        # semantic + procedural
        ("A TLS certificate chain contains the server cert, intermediate CAs, and the root CA. To verify: check each signature up the chain, confirm the root is trusted, and validate the domain name matches.", "semantic|procedural"),
        ("PostgreSQL's EXPLAIN ANALYZE shows the actual execution plan and timing. To use it: prefix your query with EXPLAIN ANALYZE, look for sequential scans on large tables, and add indexes where needed.", "semantic|procedural"),
        ("An ONNX model is a serialized computation graph with operators and weights. To load it: create an InferenceSession, specify the execution provider, then call run with input tensors.", "semantic|procedural"),
        ("BGE-small-en-v1.5 is a 384-dimensional embedding model optimized for retrieval. To generate embeddings: install fastembed, create a TextEmbedding instance, call embed with your texts.", "semantic|procedural"),
        ("A CRDT (Conflict-free Replicated Data Type) allows concurrent edits without coordination. To implement last-writer-wins: attach a logical timestamp to each update and resolve conflicts by keeping the highest timestamp.", "semantic|procedural"),
        ("AES-256-GCM is an authenticated encryption cipher providing confidentiality and integrity. To use it: generate a random 12-byte nonce, derive the key via HKDF, encrypt, and prepend the nonce to the ciphertext.", "semantic|procedural"),
        ("A Dockerfile defines the build steps for a container image. To build: write the FROM base, COPY source files, RUN build commands, set the ENTRYPOINT, then build with docker build -t name .", "semantic|procedural"),
        ("pgvector extends PostgreSQL with vector similarity search using ivfflat or hnsw indexes. To set up: CREATE EXTENSION vector, add a vector(384) column, CREATE INDEX USING hnsw, then query with ORDER BY embedding <=> query_vec.", "semantic|procedural"),
        ("RBAC (Role-Based Access Control) assigns permissions to roles, then roles to users. To implement: define roles in a roles table, create a role_permissions junction table, check permissions in middleware.", "semantic|procedural"),
        ("The softmax function converts logits into a probability distribution. To compute: subtract the max for numerical stability, exponentiate each value, then divide by the sum.", "semantic|procedural"),

        # episodic + preference
        ("Shipped our first cold email campaign yesterday. Learned the hard way: always personalize the first line with a specific pain point. Generic intros get 0% reply rate.", "episodic|preference"),
        ("Had the worst deployment of my career today. A config change took down prod for 2 hours. From now on, always deploy config changes behind feature flags.", "episodic|preference"),
        ("Lost a potential enterprise customer today because we didn't have audit logs. Never launch an enterprise tier without compliance basics.", "episodic|preference"),
        ("The demo went great this morning. Key takeaway: always show the product solving a real problem first, features second. Lead with the pain.", "episodic|preference"),
        ("Spent 4 hours debugging a race condition that a simple mutex would have prevented. Always protect shared state, even if you think there's no contention.", "episodic|preference"),

        # episodic + semantic
        ("Learned today that STARK proofs don't require a trusted setup, unlike SNARKs. This was a key factor in choosing STARKs for Minerva.", "episodic|semantic"),
        ("Discovered that fastembed uses ONNX Runtime under the hood, which is why it matches our sulcus-embed Rust crate's output exactly.", "episodic|semantic"),
        ("Found out during testing that PostgreSQL's pgvector HNSW index has a recall of 99.5% at ef_search=200, compared to 95% for ivfflat.", "episodic|semantic"),
        ("Realized today that CRDT convergence guarantees eventual consistency without coordination. This is exactly what Sulcus sync needs.", "episodic|semantic"),
        ("Tested embedding dimensions today: 384-dim BGE gives 93% accuracy on our task, while 768-dim only adds 1.2% at 2x the compute cost.", "episodic|semantic"),

        # synthesis + procedural
        ("After auditing our deployment pipeline across 6 months of incidents, the optimal process is: lint, test, build, deploy to staging, run smoke tests, canary at 5%, monitor for 30 minutes, then full rollout.", "synthesis|procedural"),
        ("The post-mortem synthesis identified a clear fix pattern: for any database migration, always take a snapshot first, run on staging with production data, verify row counts, then apply to production in a maintenance window.", "synthesis|procedural"),
        ("Analyzing our onboarding completion data reveals the ideal flow: show a 30-second value demo, ask one qualifying question, auto-configure defaults, then drop the user into their first task with guided tooltips.", "synthesis|procedural"),

        # synthesis + semantic
        ("Cross-referencing our benchmarks with the academic literature confirms that logistic regression on pre-trained embeddings matches fine-tuned transformers for classification tasks under 10 classes, at 100x less compute.", "synthesis|semantic"),
        ("After comparing all memory systems in production: the thermodynamic decay model with lambda values per type (episodic=0.05, semantic=0.01, procedural=0.02) produces the most natural forgetting curve.", "synthesis|semantic"),
        ("The competitive analysis reveals a key technical insight: all competitors use fixed TTL for memory expiry. Thermodynamic decay based on access patterns and heat is fundamentally different and more biologically accurate.", "synthesis|semantic"),

        # Triple-label examples (rarer but valid)
        ("Deployed the SIU classifier to production yesterday. The ONNX model takes 384-dim BGE embeddings and outputs class probabilities via softmax. To run: load the session, pass the embedding tensor, apply threshold at 0.5 per class. Always validate with a known test set before serving live traffic.", "episodic|semantic|procedural"),
        ("After three sprints of building the sync layer, the architecture crystallized: CRDT-based merge with vector clocks for causality. To implement: store operations as log entries, replicate via push/pull, merge with LWW on conflict. Always test with simulated network partitions.", "episodic|synthesis|procedural"),
        ("The year-end review revealed that our fastest-growing features all follow the same pattern — they solve a workflow problem, not a data problem. A workflow is: trigger, action, verification, feedback loop. Always build the feedback loop first.", "synthesis|preference|procedural"),
    ]

    # Write combined file
    output_path = MULTI_DATA_PATH
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["text", "label"], quoting=csv.QUOTE_ALL)
        writer.writeheader()

        # Write existing single-label data
        for text, label in texts_labels:
            writer.writerow({"text": text, "label": label})

        # Write new multi-label examples
        for text, label in multilabel_examples:
            writer.writerow({"text": text, "label": label})

    total = len(texts_labels) + len(multilabel_examples)
    print(f"  Written {total} examples ({len(texts_labels)} single + {len(multilabel_examples)} multi-label)")
    print(f"  Output: {output_path}")

    return output_path


# ── Train Multi-Label ──────────────────────────────────────────────────────────
def train_multilabel(X: np.ndarray, Y: np.ndarray):
    """Train OneVsRestClassifier with LogisticRegression."""

    # For multi-label, we can't use stratified split directly on the label matrix
    # Use a simple random split instead
    X_train, X_test, Y_train, Y_test = train_test_split(
        X, Y,
        test_size=TEST_SIZE,
        random_state=RANDOM_SEED,
    )
    print(f"Train: {len(X_train)} | Test: {len(X_test)}")

    # Per-class label counts in training set
    for i, cls in enumerate(CLASSES):
        pos = int(Y_train[:, i].sum())
        print(f"  {cls}: {pos} positive ({pos/len(Y_train)*100:.1f}%)")

    # Scale features
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # Train one binary LR per class
    base_lr = LogisticRegression(
        C=C,
        max_iter=MAX_ITER,
        solver=SOLVER,
        class_weight=CLASS_WEIGHT,
        random_state=RANDOM_SEED,
    )
    clf = OneVsRestClassifier(base_lr, n_jobs=-1)

    print(f"\nTraining OneVsRestClassifier (C={C}, max_iter={MAX_ITER})...")
    t0 = time.perf_counter()
    clf.fit(X_train_scaled, Y_train)
    elapsed = time.perf_counter() - t0
    print(f"Training took {elapsed:.2f}s")

    return clf, scaler, X_train_scaled, X_test_scaled, Y_train, Y_test


# ── Evaluate Multi-Label ───────────────────────────────────────────────────────
def evaluate_multilabel(clf, scaler, X_test, Y_test, threshold=0.5):
    """Evaluate multi-label classifier."""

    # Get probability predictions
    Y_prob = clf.predict_proba(X_test)

    # Apply threshold
    Y_pred = (Y_prob >= threshold).astype(int)

    # Also get hard predictions for comparison
    Y_pred_hard = clf.predict(X_test)

    print(f"\n{'='*60}")
    print(f"Multi-Label Evaluation (threshold={threshold})")
    print(f"{'='*60}")

    # Per-class metrics
    print("\nPer-class metrics (thresholded predictions):")
    report = classification_report(
        Y_test, Y_pred,
        target_names=CLASSES,
        digits=4,
        zero_division=0,
    )
    print(report)

    # Hamming loss (fraction of wrong labels)
    hl = hamming_loss(Y_test, Y_pred)
    print(f"Hamming Loss: {hl:.4f} (lower is better)")

    # Subset accuracy (exact match — all labels correct)
    subset_acc = accuracy_score(Y_test, Y_pred)
    print(f"Subset Accuracy (exact match): {subset_acc:.4f}")

    # Sample-averaged F1
    f1_samples = f1_score(Y_test, Y_pred, average="samples", zero_division=0)
    f1_macro = f1_score(Y_test, Y_pred, average="macro", zero_division=0)
    f1_micro = f1_score(Y_test, Y_pred, average="micro", zero_division=0)
    print(f"F1 (samples): {f1_samples:.4f}")
    print(f"F1 (macro):   {f1_macro:.4f}")
    print(f"F1 (micro):   {f1_micro:.4f}")

    # Multi-label stats
    labels_per_sample = Y_pred.sum(axis=1)
    print(f"\nLabels per sample: mean={labels_per_sample.mean():.2f}, "
          f"max={int(labels_per_sample.max())}, "
          f"min={int(labels_per_sample.min())}")

    # Count multi-label predictions
    multi = (labels_per_sample > 1).sum()
    print(f"Samples with multiple labels: {multi} ({multi/len(Y_test)*100:.1f}%)")

    return Y_prob, Y_pred, subset_acc


# ── Export Multi-Label ONNX ────────────────────────────────────────────────────
def export_multilabel_onnx(clf, scaler, n_features: int):
    """
    Export the multi-label pipeline to ONNX.
    Since OneVsRestClassifier doesn't export cleanly via skl2onnx in all cases,
    we export each binary classifier separately and combine.
    We'll wrap scaler + all 5 binary LRs into a single ONNX graph.
    """
    from skl2onnx import convert_sklearn
    from skl2onnx.common.data_types import FloatTensorType

    # Create a pipeline that wraps scaler + OVR for clean export
    from sklearn.pipeline import Pipeline as SKPipeline

    pipe = SKPipeline([
        ("scaler", scaler),
        ("clf", clf),
    ])

    print(f"\nExporting multi-label ONNX model to {ONNX_PATH}...")
    initial_type = [("float_input", FloatTensorType([None, n_features]))]

    try:
        onnx_model = convert_sklearn(pipe, initial_types=initial_type, target_opset=17)
        with open(ONNX_PATH, "wb") as f:
            f.write(onnx_model.SerializeToString())
        size_kb = ONNX_PATH.stat().st_size / 1024
        print(f"ONNX model saved: {ONNX_PATH} ({size_kb:.1f} KB)")
        return size_kb, "pipeline"
    except Exception as e:
        print(f"Pipeline export failed ({e}), trying manual approach...")

    # Manual approach: export scaler and each estimator separately,
    # then create a combined model
    # For now, save each binary classifier's coefficients as JSON
    # and let the Rust side reconstruct

    coefficients = []
    intercepts = []
    for est in clf.estimators_:
        coefficients.append(est.coef_[0].tolist())
        intercepts.append(float(est.intercept_[0]))

    manual_model = {
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
        "coefficients": coefficients,  # [NUM_CLASSES][n_features]
        "intercepts": intercepts,       # [NUM_CLASSES]
        "classes": CLASSES,
        "n_features": n_features,
    }

    json_path = MODEL_DIR / "memory_classifier_multilabel.json"
    with open(json_path, "w") as f:
        json.dump(manual_model, f)
    print(f"Manual model saved: {json_path}")

    # Also try exporting each binary LR separately and stacking into one ONNX
    # Build a single LogisticRegression with all classes' weights stacked
    from sklearn.linear_model import LogisticRegression as LR
    import numpy as _np

    # Create a synthetic multi-class LR that outputs sigmoid probabilities
    # by stacking all binary classifiers' weights
    coef_matrix = _np.array(coefficients)  # [5, 384]
    intercept_vec = _np.array(intercepts)  # [5]

    # Create a dummy LR and inject weights
    dummy_lr = LR()
    dummy_lr.classes_ = _np.arange(NUM_CLASSES)
    dummy_lr.coef_ = coef_matrix
    dummy_lr.intercept_ = intercept_vec

    # Wrap with scaler
    export_pipe = SKPipeline([
        ("scaler", scaler),
        ("lr", dummy_lr),
    ])

    try:
        onnx_model = convert_sklearn(export_pipe, initial_types=initial_type, target_opset=17)
        with open(ONNX_PATH, "wb") as f:
            f.write(onnx_model.SerializeToString())
        size_kb = ONNX_PATH.stat().st_size / 1024
        print(f"ONNX model saved (stacked approach): {ONNX_PATH} ({size_kb:.1f} KB)")
        return size_kb, "stacked"
    except Exception as e2:
        print(f"Stacked export also failed: {e2}")
        print("Falling back to JSON-only model (Rust will implement inference manually)")
        return 0, "json_only"


# ── Export Label Map ───────────────────────────────────────────────────────────
def export_label_map():
    """Save integer-to-label mapping as JSON."""
    label_map = {int(i): cls for i, cls in enumerate(CLASSES)}
    with open(LABEL_MAP_PATH, "w") as f:
        json.dump(label_map, f, indent=2)
    print(f"Label map saved: {LABEL_MAP_PATH}")
    print(f"  {label_map}")
    return label_map


# ── Validate ONNX ──────────────────────────────────────────────────────────────
def validate_onnx(clf, scaler, X_test, Y_test, export_type):
    """Validate ONNX output matches sklearn predictions."""
    if export_type == "json_only":
        print("\nSkipping ONNX validation (json_only export)")
        return

    import onnxruntime as rt

    sess = rt.InferenceSession(str(ONNX_PATH), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name

    X_f32 = X_test[:20].astype(np.float32)

    # ONNX inference
    pred = sess.run(None, {input_name: X_f32})

    # The ONNX model outputs: [label_predictions, probabilities]
    # For stacked approach: outputs are class labels and probability matrix
    if len(pred) >= 2:
        onnx_probs = np.array(pred[1])  # probability matrix
        print(f"\nONNX validation:")
        print(f"  Output shapes: {[p.shape if hasattr(p, 'shape') else type(p) for p in pred]}")

        if export_type == "stacked":
            # For stacked LR, apply sigmoid to raw logits to get per-class probabilities
            # But sklearn's predict_proba already does this internally
            sklearn_probs = clf.predict_proba(scaler.transform(X_f32))

            # Compare
            diff = np.abs(onnx_probs[:, :NUM_CLASSES] - sklearn_probs).max()
            print(f"  Max probability difference: {diff:.6f}")
            print(f"  Match: {'✅ PASS' if diff < 0.01 else '⚠️ DRIFT'}")
    else:
        print(f"\nONNX outputs: {len(pred)} tensors")
        print(f"  Shapes: {[p.shape if hasattr(p, 'shape') else type(p) for p in pred]}")

    # Latency benchmark
    X_single = X_test[:1].astype(np.float32)
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
    print("Sulcus Memory Type Classifier — Multi-Label BGE Training")
    print("Author: Digital Forge Studios")
    print("=" * 60)

    # 1. Generate multi-label training data
    data_path = generate_multilabel_data()

    # 2. Load data
    print(f"\nLoading data from {data_path}...")
    texts, Y = load_data(data_path)
    print(f"Loaded {len(texts)} examples")
    print(f"Label matrix shape: {Y.shape}")

    # Stats
    labels_per_sample = Y.sum(axis=1)
    multi_count = (labels_per_sample > 1).sum()
    print(f"Single-label: {(labels_per_sample == 1).sum()}")
    print(f"Multi-label:  {multi_count} ({multi_count/len(texts)*100:.1f}%)")
    for i, cls in enumerate(CLASSES):
        pos = int(Y[:, i].sum())
        print(f"  {cls}: {pos} positive ({pos/len(texts)*100:.1f}%)")

    # 3. Embed
    embeddings = embed_texts(texts)

    # 4. Train
    clf, scaler, X_train, X_test, Y_train, Y_test = train_multilabel(embeddings, Y)

    # 5. Evaluate
    Y_prob, Y_pred, subset_acc = evaluate_multilabel(clf, scaler, X_test, Y_test)

    # 6. Export
    size_kb, export_type = export_multilabel_onnx(clf, scaler, embeddings.shape[1])
    label_map = export_label_map()

    # 7. Validate ONNX
    validate_onnx(clf, scaler, X_test, Y_test, export_type)

    # 8. Also export the JSON model (always, as fallback)
    coefficients = []
    intercepts = []
    for est in clf.estimators_:
        coefficients.append(est.coef_[0].tolist())
        intercepts.append(float(est.intercept_[0]))

    manual_model = {
        "type": "multilabel",
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
        "coefficients": coefficients,
        "intercepts": intercepts,
        "classes": CLASSES,
        "n_features": embeddings.shape[1],
        "default_threshold": 0.5,
    }
    json_path = MODEL_DIR / "memory_classifier_multilabel.json"
    with open(json_path, "w") as f:
        json.dump(manual_model, f)
    json_size = json_path.stat().st_size / 1024
    print(f"\nJSON model saved: {json_path} ({json_size:.1f} KB)")

    print("\n✅ Multi-label training complete!")
    print(f"   ONNX Model:  {ONNX_PATH} ({size_kb:.1f} KB)" if size_kb > 0 else f"   ONNX Model:  not exported (using JSON)")
    print(f"   JSON Model:  {json_path} ({json_size:.1f} KB)")
    print(f"   Subset Acc:  {subset_acc*100:.2f}%")
    print(f"   Label map:   {LABEL_MAP_PATH}")
    print(f"   Embedding:   {EMBEDDING_MODEL} (384-dim)")
    print(f"   Multi-label examples: {multi_count}")

    return subset_acc


if __name__ == "__main__":
    main()