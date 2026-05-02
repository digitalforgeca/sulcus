#!/usr/bin/env python3
"""
siu_repo.py — Per-agent SIU model repository manager.

Each agent gets its own git-versioned directory containing:
- sivu_model.onnx — quality gate model
- sicu_model.onnx — type classifier model  
- situ_model.onnx — trigger evaluator (when trained)
- manifest.json — model metadata, metrics, lineage
- training_signals.jsonl — accumulated corrections (exported from server)

Every retrain = git commit. Full history for A/B testing, rollback, and audit.
Clone between agents = fork the repo (transfer learning as a social feature).

Storage root: SIU_REPOS_DIR env var (default: /opt/sulcus/siu-repos/)
Per-agent path: {root}/{tenant_id}/{agent_id}/

Usage:
    # Initialize a new agent repo from base models
    python siu_repo.py init --tenant dooley --agent daedalus

    # Fork one agent's models to another
    python siu_repo.py fork --from dooley/daedalus --to dooley/icarus

    # Commit new models after retrain
    python siu_repo.py commit --tenant dooley --agent daedalus --message "retrain: 47 new signals"

    # List all versions
    python siu_repo.py log --tenant dooley --agent daedalus

    # Rollback to a previous version
    python siu_repo.py rollback --tenant dooley --agent daedalus --ref HEAD~1

    # A/B compare two versions
    python siu_repo.py diff --tenant dooley --agent daedalus --a HEAD~1 --b HEAD

    # Export current models for deployment
    python siu_repo.py export --tenant dooley --agent daedalus --output /tmp/models/

    # List all agent repos
    python siu_repo.py list --tenant dooley
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_REPOS_DIR = "/opt/sulcus/siu-repos"
BASE_MODELS_DIR = os.path.join(os.path.dirname(__file__), "models", "base")

MANIFEST_TEMPLATE = {
    "schema_version": 1,
    "agent_id": "",
    "tenant_id": "",
    "created_at": "",
    "updated_at": "",
    "parent": None,  # For forks: "{tenant}/{agent}@{commit}"
    "models": {
        "sivu": {
            "file": "sivu_model.onnx",
            "labels_file": "sivu_model_labels.json",
            "version": "v0.1-base",
            "accuracy": None,
            "training_samples": 0,
            "architecture": "tfidf_sgd",
        },
        "sicu": {
            "file": "sicu_model.onnx",
            "labels_file": "sicu_model_labels.json",
            "version": "v0.1-base",
            "accuracy": None,
            "training_samples": 0,
            "architecture": "tfidf_sgd",
        },
        "situ": {
            "file": None,
            "labels_file": None,
            "version": None,
            "accuracy": None,
            "training_samples": 0,
            "architecture": "tfidf_sgd",
        },
    },
    "retrain_count": 0,
    "signal_count": 0,
}


def repos_dir() -> Path:
    return Path(os.environ.get("SIU_REPOS_DIR", DEFAULT_REPOS_DIR))


def agent_repo_path(tenant: str, agent: str) -> Path:
    return repos_dir() / tenant / agent


def git(repo_path: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    """Run a git command in the repo directory."""
    return subprocess.run(
        ["git", *args],
        cwd=repo_path,
        capture_output=True,
        text=True,
        check=check,
    )


def init_repo(tenant: str, agent: str, base_dir: str = BASE_MODELS_DIR) -> Path:
    """Initialize a new agent SIU repo from base models."""
    repo = agent_repo_path(tenant, agent)
    
    if repo.exists():
        print(f"ERROR: Repo already exists at {repo}")
        sys.exit(1)
    
    repo.mkdir(parents=True, exist_ok=True)
    
    # Initialize git
    git(repo, "init")
    git(repo, "config", "user.name", f"sulcus-siu-{agent}")
    git(repo, "config", "user.email", f"{agent}@siu.sulcus.local")
    
    # Copy base models
    base = Path(base_dir)
    for f in base.iterdir():
        if f.is_file():
            shutil.copy2(f, repo / f.name)
    
    # Create manifest
    manifest = MANIFEST_TEMPLATE.copy()
    manifest["agent_id"] = agent
    manifest["tenant_id"] = tenant
    manifest["created_at"] = datetime.now(timezone.utc).isoformat()
    manifest["updated_at"] = manifest["created_at"]
    
    # Read base model metrics if available
    for model_key in ["sivu", "sicu"]:
        onnx_file = repo / f"{model_key}_model.onnx"
        if onnx_file.exists():
            manifest["models"][model_key]["version"] = "v0.1-base"
            size = onnx_file.stat().st_size
            manifest["models"][model_key]["onnx_size_bytes"] = size
    
    with open(repo / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    
    # Create empty signals file
    (repo / "training_signals.jsonl").touch()
    
    # Create .gitattributes for ONNX binary handling
    with open(repo / ".gitattributes", "w") as f:
        f.write("*.onnx binary\n")
        f.write("*.jsonl text\n")
        f.write("*.json text\n")
    
    # Initial commit
    git(repo, "add", "-A")
    git(repo, "commit", "-m", f"init: base models for {tenant}/{agent}")
    
    print(f"Initialized SIU repo at {repo}")
    print(f"  SIVU: {'✅' if (repo / 'sivu_model.onnx').exists() else '❌'}")
    print(f"  SICU: {'✅' if (repo / 'sicu_model.onnx').exists() else '❌'}")
    print(f"  SITU: ❌ (needs training data)")
    
    return repo


def fork_repo(from_spec: str, to_spec: str) -> Path:
    """Fork one agent's models to another agent."""
    from_tenant, from_agent = from_spec.split("/")
    to_tenant, to_agent = to_spec.split("/")
    
    from_repo = agent_repo_path(from_tenant, from_agent)
    to_repo = agent_repo_path(to_tenant, to_agent)
    
    if not from_repo.exists():
        print(f"ERROR: Source repo not found: {from_repo}")
        sys.exit(1)
    
    if to_repo.exists():
        print(f"ERROR: Target repo already exists: {to_repo}")
        sys.exit(1)
    
    # Get current commit of source
    result = git(from_repo, "rev-parse", "--short", "HEAD")
    source_commit = result.stdout.strip()
    
    # Copy the entire repo (including .git history)
    shutil.copytree(from_repo, to_repo)
    
    # Update git config for new agent
    git(to_repo, "config", "user.name", f"sulcus-siu-{to_agent}")
    git(to_repo, "config", "user.email", f"{to_agent}@siu.sulcus.local")
    
    # Update manifest
    manifest_path = to_repo / "manifest.json"
    with open(manifest_path) as f:
        manifest = json.load(f)
    
    manifest["agent_id"] = to_agent
    manifest["tenant_id"] = to_tenant
    manifest["parent"] = f"{from_tenant}/{from_agent}@{source_commit}"
    manifest["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    # Reset signal count (new agent starts fresh with accumulated signals)
    manifest["signal_count"] = 0
    
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    
    # Clear training signals (agent starts collecting their own)
    with open(to_repo / "training_signals.jsonl", "w") as f:
        f.write("")
    
    # Commit the fork
    git(to_repo, "add", "-A")
    git(to_repo, "commit", "-m",
        f"fork: from {from_tenant}/{from_agent}@{source_commit}")
    
    print(f"Forked {from_spec}@{source_commit} → {to_spec}")
    print(f"  Parent: {manifest['parent']}")
    print(f"  Models: inherited, signals: reset")
    
    return to_repo


def commit_models(
    tenant: str,
    agent: str,
    message: str = "",
    metrics: dict = None,
) -> str:
    """Commit current model state after retrain."""
    repo = agent_repo_path(tenant, agent)
    
    if not repo.exists():
        print(f"ERROR: Repo not found: {repo}")
        sys.exit(1)
    
    # Update manifest
    manifest_path = repo / "manifest.json"
    with open(manifest_path) as f:
        manifest = json.load(f)
    
    manifest["updated_at"] = datetime.now(timezone.utc).isoformat()
    manifest["retrain_count"] = manifest.get("retrain_count", 0) + 1
    
    # Update model metrics if provided
    if metrics:
        for model_key, model_metrics in metrics.items():
            if model_key in manifest["models"]:
                manifest["models"][model_key].update(model_metrics)
    
    # Count signals
    signals_file = repo / "training_signals.jsonl"
    if signals_file.exists():
        with open(signals_file) as f:
            manifest["signal_count"] = sum(1 for line in f if line.strip())
    
    # Update ONNX sizes
    for model_key in ["sivu", "sicu", "situ"]:
        onnx_file = repo / f"{model_key}_model.onnx"
        if onnx_file.exists():
            manifest["models"][model_key]["onnx_size_bytes"] = onnx_file.stat().st_size
    
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    
    # Commit
    git(repo, "add", "-A")
    
    if not message:
        message = f"retrain #{manifest['retrain_count']}: {manifest['signal_count']} signals"
    
    git(repo, "commit", "-m", message, check=False)  # May have nothing to commit
    
    result = git(repo, "rev-parse", "--short", "HEAD")
    commit = result.stdout.strip()
    
    print(f"Committed {tenant}/{agent}@{commit}: {message}")
    return commit


def show_log(tenant: str, agent: str, count: int = 20):
    """Show git log for an agent's SIU repo."""
    repo = agent_repo_path(tenant, agent)
    
    if not repo.exists():
        print(f"ERROR: Repo not found: {repo}")
        sys.exit(1)
    
    result = git(repo, "log", f"--oneline", f"-{count}", "--decorate")
    print(f"SIU history for {tenant}/{agent}:\n")
    print(result.stdout)


def rollback(tenant: str, agent: str, ref: str):
    """Rollback to a previous version."""
    repo = agent_repo_path(tenant, agent)
    
    if not repo.exists():
        print(f"ERROR: Repo not found: {repo}")
        sys.exit(1)
    
    # Create a rollback commit (not destructive — preserves history)
    git(repo, "checkout", ref, "--", ".")
    git(repo, "add", "-A")
    
    result = git(repo, "rev-parse", "--short", ref)
    target = result.stdout.strip()
    
    git(repo, "commit", "-m", f"rollback: reverted to {target}")
    
    new_result = git(repo, "rev-parse", "--short", "HEAD")
    print(f"Rolled back {tenant}/{agent} to {target} (new commit: {new_result.stdout.strip()})")


def diff_versions(tenant: str, agent: str, ref_a: str, ref_b: str):
    """Compare manifest.json between two versions (A/B testing reference)."""
    repo = agent_repo_path(tenant, agent)
    
    if not repo.exists():
        print(f"ERROR: Repo not found: {repo}")
        sys.exit(1)
    
    # Get manifest at each ref
    result_a = git(repo, "show", f"{ref_a}:manifest.json", check=False)
    result_b = git(repo, "show", f"{ref_b}:manifest.json", check=False)
    
    if result_a.returncode != 0 or result_b.returncode != 0:
        print("ERROR: Could not read manifest at one or both refs")
        return
    
    manifest_a = json.loads(result_a.stdout)
    manifest_b = json.loads(result_b.stdout)
    
    print(f"A/B comparison: {ref_a} vs {ref_b}\n")
    print(f"{'Model':<8} {'Metric':<20} {'A':>12} {'B':>12} {'Delta':>12}")
    print("-" * 68)
    
    for model_key in ["sivu", "sicu", "situ"]:
        ma = manifest_a.get("models", {}).get(model_key, {})
        mb = manifest_b.get("models", {}).get(model_key, {})
        
        for metric in ["accuracy", "training_samples", "onnx_size_bytes"]:
            va = ma.get(metric)
            vb = mb.get(metric)
            if va is None and vb is None:
                continue
            
            va_str = f"{va:.4f}" if isinstance(va, float) else str(va or "—")
            vb_str = f"{vb:.4f}" if isinstance(vb, float) else str(vb or "—")
            
            if isinstance(va, (int, float)) and isinstance(vb, (int, float)):
                delta = vb - va
                delta_str = f"{delta:+.4f}" if isinstance(delta, float) else f"{delta:+d}"
            else:
                delta_str = "—"
            
            print(f"{model_key:<8} {metric:<20} {va_str:>12} {vb_str:>12} {delta_str:>12}")
    
    print(f"\n{'':8} {'retrain_count':<20} {manifest_a.get('retrain_count', 0):>12} {manifest_b.get('retrain_count', 0):>12}")
    print(f"{'':8} {'signal_count':<20} {manifest_a.get('signal_count', 0):>12} {manifest_b.get('signal_count', 0):>12}")


def export_models(tenant: str, agent: str, output_dir: str):
    """Export current models to a directory (for deployment)."""
    repo = agent_repo_path(tenant, agent)
    
    if not repo.exists():
        print(f"ERROR: Repo not found: {repo}")
        sys.exit(1)
    
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    
    exported = 0
    for f in repo.iterdir():
        if f.name.startswith(".git") or f.name == "training_signals.jsonl":
            continue
        shutil.copy2(f, out / f.name)
        exported += 1
    
    print(f"Exported {exported} files from {tenant}/{agent} → {output_dir}")


def list_repos(tenant: str = None):
    """List all agent repos."""
    root = repos_dir()
    
    if not root.exists():
        print(f"No repos found at {root}")
        return
    
    tenants = [tenant] if tenant else [d.name for d in root.iterdir() if d.is_dir()]
    
    for t in sorted(tenants):
        tenant_dir = root / t
        if not tenant_dir.exists():
            continue
        
        for agent_dir in sorted(tenant_dir.iterdir()):
            if not agent_dir.is_dir() or agent_dir.name.startswith("."):
                continue
            
            manifest_path = agent_dir / "manifest.json"
            if not manifest_path.exists():
                print(f"  {t}/{agent_dir.name}: (no manifest)")
                continue
            
            with open(manifest_path) as f:
                m = json.load(f)
            
            result = git(agent_dir, "rev-parse", "--short", "HEAD", check=False)
            commit = result.stdout.strip() if result.returncode == 0 else "?"
            
            result = git(agent_dir, "rev-list", "--count", "HEAD", check=False)
            commits = result.stdout.strip() if result.returncode == 0 else "?"
            
            sivu = "✅" if (agent_dir / "sivu_model.onnx").exists() else "❌"
            sicu = "✅" if (agent_dir / "sicu_model.onnx").exists() else "❌"
            situ = "✅" if (agent_dir / "situ_model.onnx").exists() else "❌"
            
            parent = m.get("parent") or "base"
            retrains = m.get("retrain_count", 0)
            signals = m.get("signal_count", 0)
            
            print(f"  {t}/{agent_dir.name}  @{commit} ({commits} commits)")
            print(f"    SIVU {sivu}  SICU {sicu}  SITU {situ}")
            print(f"    retrains: {retrains}  signals: {signals}  parent: {parent}")


def main():
    parser = argparse.ArgumentParser(description="Per-agent SIU model repository manager")
    sub = parser.add_subparsers(dest="command")
    
    # init
    p = sub.add_parser("init", help="Initialize agent repo from base models")
    p.add_argument("--tenant", required=True)
    p.add_argument("--agent", required=True)
    p.add_argument("--base-dir", default=BASE_MODELS_DIR)
    
    # fork
    p = sub.add_parser("fork", help="Fork one agent's models to another")
    p.add_argument("--from", dest="from_spec", required=True, help="tenant/agent")
    p.add_argument("--to", dest="to_spec", required=True, help="tenant/agent")
    
    # commit
    p = sub.add_parser("commit", help="Commit current models after retrain")
    p.add_argument("--tenant", required=True)
    p.add_argument("--agent", required=True)
    p.add_argument("--message", "-m", default="")
    p.add_argument("--metrics", help="JSON string of model metrics")
    
    # log
    p = sub.add_parser("log", help="Show version history")
    p.add_argument("--tenant", required=True)
    p.add_argument("--agent", required=True)
    p.add_argument("--count", "-n", type=int, default=20)
    
    # rollback
    p = sub.add_parser("rollback", help="Rollback to previous version")
    p.add_argument("--tenant", required=True)
    p.add_argument("--agent", required=True)
    p.add_argument("--ref", required=True, help="Git ref (commit hash, HEAD~1, etc.)")
    
    # diff
    p = sub.add_parser("diff", help="A/B compare two versions")
    p.add_argument("--tenant", required=True)
    p.add_argument("--agent", required=True)
    p.add_argument("--a", default="HEAD~1")
    p.add_argument("--b", default="HEAD")
    
    # export
    p = sub.add_parser("export", help="Export models for deployment")
    p.add_argument("--tenant", required=True)
    p.add_argument("--agent", required=True)
    p.add_argument("--output", "-o", required=True)
    
    # list
    p = sub.add_parser("list", help="List all agent repos")
    p.add_argument("--tenant", default=None)
    
    args = parser.parse_args()
    
    if args.command == "init":
        init_repo(args.tenant, args.agent, args.base_dir)
    elif args.command == "fork":
        fork_repo(args.from_spec, args.to_spec)
    elif args.command == "commit":
        metrics = json.loads(args.metrics) if args.metrics else None
        commit_models(args.tenant, args.agent, args.message, metrics)
    elif args.command == "log":
        show_log(args.tenant, args.agent, args.count)
    elif args.command == "rollback":
        rollback(args.tenant, args.agent, args.ref)
    elif args.command == "diff":
        diff_versions(args.tenant, args.agent, args.a, args.b)
    elif args.command == "export":
        export_models(args.tenant, args.agent, args.output)
    elif args.command == "list":
        list_repos(args.tenant)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
