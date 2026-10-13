"""Sulcus Proactive Memory Plugin for Hermes Agent.

Hybrid local/remote memory integration mirroring Sulcus AGY/Claude Code plugin lifecycle.
Hooks: pre_llm_call (recall), post_llm_call (capture), on_session_start/end, pre_auxiliary_call (compaction).
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from hermes_cli.plugins import PluginContext, PluginManifest, PluginRegistration

# Configuration defaults
DEFAULT_SULCUS_SERVER = "https://api.sulcus.ca"
DEFAULT_TOKEN_BUDGET = 4000
DEFAULT_NAMESPACE = "hermes-default"

# Hook timeout (seconds)
HOOK_TIMEOUT = 30.0

# Global state for topic caching across hook invocations
_topic_cache: dict[str, Any] = {}
_last_recall_results: list[dict[str, Any]] = []

# MCP stdio process for local sulcus
_mcp_process: Optional[subprocess.Popen] = None
_mcp_request_id = 0


@dataclass
class SulcusConfig:
    """Resolved plugin configuration."""
    server_url: str
    api_key: str
    namespace: str
    token_budget: int
    auto_recall: bool
    auto_capture: bool
    hybrid_mode: bool
    local_binary: str


def resolve_config(ctx: PluginContext) -> SulcusConfig:
    """Resolve config from plugin settings and environment."""
    server_url = ctx.get_config("sulcus_server_url") or os.getenv("SULCUS_SERVER_URL", DEFAULT_SULCUS_SERVER)
    api_key = ctx.get_config("sulcus_api_key") or os.getenv("SULCUS_API_KEY", "")
    namespace = ctx.get_config("namespace") or os.getenv("SULCUS_NAMESPACE", DEFAULT_NAMESPACE)
    token_budget = ctx.get_config("token_budget") or DEFAULT_TOKEN_BUDGET
    auto_recall = ctx.get_config("auto_recall", True)
    auto_capture = ctx.get_config("auto_capture", True)
    hybrid_mode = ctx.get_config("hybrid_mode", True)

    # Find local sulcus binary
    local_binary = "sulcus"
    if hybrid_mode:
        # Check common locations
        for path in [
            "~/dev/sulcus/target/release/sulcus",
            "~/.cargo/bin/sulcus",
            "/usr/local/bin/sulcus",
        ]:
            expanded = Path(path).expanduser()
            if expanded.exists():
                local_binary = str(expanded)
                break

    return SulcusConfig(
        server_url=server_url,
        api_key=api_key,
        namespace=namespace,
        token_budget=token_budget,
        auto_recall=auto_recall,
        auto_capture=auto_capture,
        hybrid_mode=hybrid_mode,
        local_binary=local_binary,
    )


def get_mcp_process(cfg: SulcusConfig) -> Optional[subprocess.Popen]:
    """Get or start the MCP stdio process for local sulcus."""
    global _mcp_process
    
    # Only use MCP if we have a local binary and hybrid mode
    if not cfg.hybrid_mode or not Path(cfg.local_binary).exists():
        return None
    
    if _mcp_process is not None and _mcp_process.poll() is None:
        return _mcp_process
    
    # Start MCP stdio process
    env = os.environ.copy()
    env["SULCUS_NAMESPACE"] = cfg.namespace
    if cfg.api_key:
        env["SULCUS_API_KEY"] = cfg.api_key
    env["SULCUS_SERVER_URL"] = cfg.server_url
    
    try:
        _mcp_process = subprocess.Popen(
            [cfg.local_binary, "stdio"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            text=True,
            bufsize=1,
        )
        # Give it a moment to start
        time.sleep(0.5)
        if _mcp_process.poll() is not None:
            stderr = _mcp_process.stderr.read() if _mcp_process.stderr else ""
            print(f"[Sulcus] MCP process failed to start: {stderr}")
            _mcp_process = None
            return None
        return _mcp_process
    except Exception as e:
        print(f"[Sulcus] Failed to start MCP process: {e}")
        _mcp_process = None
        return None


def mcp_call(cfg: SulcusConfig, method: str, params: dict = None) -> Optional[dict]:
    """Call MCP tool via stdio."""
    proc = get_mcp_process(cfg)
    if not proc or not proc.stdin or not proc.stdout:
        return None
    
    global _mcp_request_id
    _mcp_request_id += 1
    
    request = {
        "jsonrpc": "2.0",
        "id": _mcp_request_id,
        "method": method,
        "params": params or {},
    }
    
    try:
        proc.stdin.write(json.dumps(request) + "\n")
        proc.stdin.flush()
        
        # Read response (with timeout)
        import select
        ready, _, _ = select.select([proc.stdout], [], [], 3.0)
        if not ready:
            sys.stderr.write(f"[Sulcus] mcp_call: timeout waiting for response\n")
            return None
        
        line = proc.stdout.readline()
        if not line:
            sys.stderr.write(f"[Sulcus] mcp_call: empty response\n")
            return None
        
        response = json.loads(line)
        if "error" in response:
            sys.stderr.write(f"[Sulcus] mcp_call: error in response: {response['error']}\n")
            return None
        return response.get("result")
    except json.JSONDecodeError as e:
        sys.stderr.write(f"[Sulcus] mcp_call: JSON decode error: {e}\n")
        return None
    except Exception as e:
        sys.stderr.write(f"[Sulcus] mcp_call: exception: {e}\n")
        return None


def sulcus_recall(cfg: SulcusConfig, query: str, limit: int = 5) -> list[dict[str, Any]]:
    """Recall memories from Sulcus - tries MCP first, falls back to REST."""
    # Try MCP first for local
    if cfg.hybrid_mode and Path(cfg.local_binary).exists():
        result = mcp_call(cfg, "tools/call", {
            "name": "search_memory",
            "arguments": {"query": query, "limit": limit, "namespace": cfg.namespace}
        })
        if result and isinstance(result, dict) and "content" in result:
            # Parse MCP content response
            try:
                content = result["content"]
                if isinstance(content, list) and content:
                    text = content[0].get("text", "{}")
                    data = json.loads(text)
                    if isinstance(data, dict) and "results" in data:
                        return data["results"]
                    if isinstance(data, list):
                        return data
            except Exception:
                pass
    
    # Fallback to REST API
    return sulcus_search(cfg, query, limit, 0.3)


def sulcus_search(cfg: SulcusConfig, query: str, limit: int = 5, threshold: float = 0.3) -> list[dict[str, Any]]:
    """Search memories via Sulcus REST API."""
    if not cfg.api_key:
        return []
    import urllib.request
    import urllib.error

    url = f"{cfg.server_url.rstrip('/')}/api/v1/agent/search"
    payload = json.dumps({"query": query, "limit": limit, "threshold": threshold}).encode()

    try:
        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Authorization": f"Bearer {cfg.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            data = json.loads(resp.read().decode())
            if isinstance(data, dict) and "results" in data:
                return data["results"]
            return []
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError):
        return []


def sulcus_store(cfg: SulcusConfig, content: str, memory_type: str = "episodic", metadata: Optional[dict] = None) -> bool:
    """Store a memory in Sulcus - tries MCP first, falls back to REST."""
    # Try MCP first for local
    if cfg.hybrid_mode and Path(cfg.local_binary).exists():
        result = mcp_call(cfg, "tools/call", {
            "name": "store_memory",
            "arguments": {
                "content": content,
                "memory_type": memory_type,
                "namespace": cfg.namespace,
                "metadata": metadata or {},
            }
        })
        if result:
            return True
    
    # Fallback to REST API
    if not cfg.api_key:
        return False
    import urllib.request
    import urllib.error

    url = f"{cfg.server_url.rstrip('/')}/api/v1/agent/memory"
    payload = json.dumps({
        "content": content,
        "memory_type": memory_type,
        "metadata": metadata or {},
    }).encode()

    try:
        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Authorization": f"Bearer {cfg.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            return resp.status == 200
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        return False


def sulcus_build_context(cfg: SulcusConfig, prompt: str, token_budget: int = 2000) -> Optional[str]:
    """Build context XML via MCP build_context tool."""
    if cfg.hybrid_mode and Path(cfg.local_binary).exists():
        print(f"[Sulcus] sulcus_build_context: calling MCP build_context for prompt='{prompt[:50]}...'")
        result = mcp_call(cfg, "tools/call", {
            "name": "build_context",
            "arguments": {"prompt": prompt, "token_budget": token_budget, "format": "xml"}
        })
        if result and isinstance(result, dict) and "content" in result:
            content = result["content"]
            if isinstance(content, list) and content:
                text = content[0].get("text", "")
                print(f"[Sulcus] sulcus_build_context: got {len(text)} chars")
                return text
        print(f"[Sulcus] sulcus_build_context: failed or empty result")
    return None


def should_capture(content: str) -> bool:
    """Heuristic: should we capture this content?"""
    if len(content) < 20:
        return False
    # Skip generic acknowledgments
    generic = {"ok", "thanks", "got it", "understood", "sure", "yes", "no"}
    if content.strip().lower() in generic:
        return False
    return True


def is_correction_message(content: str) -> bool:
    """Detect if user is correcting the agent."""
    corrections = ["actually", "no, ", "that's wrong", "not correct", "you misunderstood", "I meant"]
    return any(c in content.lower() for c in corrections)


def extract_signal_content(text: str, max_chars: int = 2000) -> str:
    """Extract high-signal content for storage."""
    # Simple heuristic: look for keywords
    keywords = ["decision", "prefer", "always", "never", "important", "note", "remember",
                "pattern", "strategy", "approach", "failed", "error", "bug", "fix",
                "deploy", "config", "setup", "architecture", "design"]
    sentences = text.split(". ")
    relevant = [s for s in sentences if any(k in s.lower() for k in keywords)]
    result = ". ".join(relevant) if relevant else text
    return result[:max_chars]


# =============================================================================
# HOOK IMPLEMENTATIONS
# =============================================================================

def pre_llm_call_hook(**kwargs) -> Optional[dict]:
    """PreInvocation equivalent: Recall relevant memories before LLM call."""
    # Get config from the plugin context during registration
    # Since ctx isn't passed to hooks, we need to resolve config from env
    import os
    from pathlib import Path
    
    # Resolve config from environment
    server_url = os.getenv("SULCUS_SERVER_URL", "https://api.sulcus.ca")
    api_key = os.getenv("SULCUS_API_KEY", "")
    namespace = os.getenv("SULCUS_NAMESPACE", "icarus")
    token_budget = int(os.getenv("SULCUS_TOKEN_BUDGET", "4000"))
    auto_recall = os.getenv("SULCUS_AUTO_RECALL", "true").lower() == "true"
    auto_capture = os.getenv("SULCUS_AUTO_CAPTURE", "true").lower() == "true"
    hybrid_mode = os.getenv("SULCUS_HYBRID_MODE", "true").lower() == "true"
    
    # Find local sulcus binary
    local_binary = "sulcus"
    if hybrid_mode:
        for path in [
            "~/dev/sulcus/target/release/sulcus",
            "~/.cargo/bin/sulcus",
            "/usr/local/bin/sulcus",
        ]:
            expanded = Path(path).expanduser()
            if expanded.exists():
                local_binary = str(expanded)
                break
    
    # DEBUG: Log hook entry with actual parameters - ALWAYS PRINT
    session_id = kwargs.get("session_id", "")
    user_message = kwargs.get("user_message", "")
    is_first_turn = kwargs.get("is_first_turn", False)
    model = kwargs.get("model", "")
    platform = kwargs.get("platform", "")
    
    sys.stderr.write(f"[Sulcus] pre_llm_call: session={session_id[:8] if session_id else 'none'}, user_message_len={len(user_message)}, first_turn={is_first_turn}, model={model}, platform={platform}\n")
    sys.stderr.write(f"[Sulcus] pre_llm_call: auto_recall={auto_recall}, api_key={'set' if api_key else 'none'}, hybrid={hybrid_mode}, binary_exists={Path(local_binary).exists()}\n")
    if not auto_recall or not (api_key or (hybrid_mode and Path(local_binary).exists())):
        sys.stderr.write(f"[Sulcus] pre_llm_call: SKIPPED - conditions not met\n")
        return None

    # Use user_message parameter directly
    prompt = user_message
    if not prompt or len(prompt) < 15:
        sys.stderr.write(f"[Sulcus] pre_llm_call: SKIPPED - prompt too short or empty\n")
        return None

    sys.stderr.write(f"[Sulcus] pre_llm_call: processing prompt='{prompt[:50]}...'\n")

    # Try build_context first (optimized MCP tool) - use local binary via MCP
    # For now, fall back to manual recall since build_context needs MCP
    # Fallback to manual recall + formatting
    # Topic-shift caching (simple version)
    global _topic_cache, _last_recall_results
    cache_key = hash(prompt[:100])  # Simplified topic detection
    if cache_key in _topic_cache:
        memories = _topic_cache[cache_key]
        sys.stderr.write(f"[Sulcus] pre_llm_call: cache hit\n")
    else:
        # Use MCP recall via local binary
        memories = []
        if hybrid_mode and Path(local_binary).exists():
            # Call MCP search_memory
            import subprocess, json
            env = os.environ.copy()
            env["SULCUS_SERVER_URL"] = server_url
            if api_key:
                env["SULCUS_API_KEY"] = api_key
            env["SULCUS_NAMESPACE"] = namespace
            
            try:
                proc = subprocess.Popen(
                    [local_binary, "stdio"],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=env,
                    text=True,
                    bufsize=1,
                )
                time.sleep(0.5)
                if proc.poll() is None:
                    request = {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tools/call",
                        "params": {
                            "name": "search_memory",
                            "arguments": {"query": prompt, "limit": 10, "namespace": namespace}
                        }
                    }
                    proc.stdin.write(json.dumps(request) + "\n")
                    proc.stdin.flush()
                    import select
                    ready, _, _ = select.select([proc.stdout], [], [], 5.0)
                    if ready:
                        line = proc.stdout.readline()
                        if line:
                            response = json.loads(line)
                            result = response.get("result")
                            if result and isinstance(result, dict) and "content" in result:
                                content = result["content"]
                                if isinstance(content, list) and content:
                                    text = content[0].get("text", "{}")
                                    data = json.loads(text)
                                    if isinstance(data, dict) and "results" in data:
                                        memories = data["results"]
                                    elif isinstance(data, list):
                                        memories = data
            except Exception as e:
                sys.stderr.write(f"[Sulcus] pre_llm_call: MCP recall failed: {e}\n")
        
        if memories:
            _topic_cache[cache_key] = memories
            if len(_topic_cache) > 50:
                _topic_cache.clear()
        sys.stderr.write(f"[Sulcus] pre_llm_call: recall returned {len(memories)} memories\n")

    if not memories:
        sys.stderr.write(f"[Sulcus] pre_llm_call: no memories found\n")
        return None

    # Filter by relevance threshold
    memories = [m for m in memories if m.get("score", 0) > 0.3 or m.get("current_heat", 0) > 0.2]
    if not memories:
        sys.stderr.write(f"[Sulcus] pre_llm_call: no memories after filter\n")
        return None

    # Token budget packing
    budget_chars = token_budget * 4  # ~4 chars/token
    used = 0
    items = []

    for m in memories:
        heat = m.get("current_heat", m.get("heat", 0))
        mtype = m.get("memory_type", m.get("type", "unknown"))
        label = m.get("label") or m.get("content", "")[:200]
        line = f"- [{mtype}] {label} (heat: {heat:.2f})"
        if used + len(line) > budget_chars and items:
            break
        items.append(line)
        used += len(line)

    if not items:
        sys.stderr.write(f"[Sulcus] pre_llm_call: no items after budget packing\n")
        return None

    _last_recall_results = memories[:len(items)]
    context = f"<sulcus-recall>\n## Relevant Memories\n\n{chr(10).join(items)}\n\nUse these memories when relevant to the user's request.\n</sulcus-recall>"
    sys.stderr.write(f"[Sulcus] pre_llm_call: injecting {len(items)} memories, {len(context)} chars\n")
    return {"context": context}


def post_llm_call_hook(**kwargs) -> None:
    """PostInvocation equivalent: Capture assistant response via SIU quality gate."""
    # Resolve config from environment
    import os
    from pathlib import Path
    
    server_url = os.getenv("SULCUS_SERVER_URL", "https://api.sulcus.ca")
    api_key = os.getenv("SULCUS_API_KEY", "")
    namespace = os.getenv("SULCUS_NAMESPACE", "icarus")
    token_budget = int(os.getenv("SULCUS_TOKEN_BUDGET", "4000"))
    auto_capture = os.getenv("SULCUS_AUTO_CAPTURE", "true").lower() == "true"
    hybrid_mode = os.getenv("SULCUS_HYBRID_MODE", "true").lower() == "true"
    
    # Find local sulcus binary
    local_binary = "sulcus"
    if hybrid_mode:
        for path in [
            "~/dev/sulcus/target/release/sulcus",
            "~/.cargo/bin/sulcus",
            "/usr/local/bin/sulcus",
        ]:
            expanded = Path(path).expanduser()
            if expanded.exists():
                local_binary = str(expanded)
                break
    
    sys.stderr.write(f"[Sulcus] post_llm_call: auto_capture={auto_capture}, api_key={'set' if api_key else 'none'}, hybrid={hybrid_mode}, binary_exists={Path(local_binary).exists()}\n")
    if not auto_capture or not (api_key or (hybrid_mode and Path(local_binary).exists())):
        return

    response = kwargs.get("assistant_response", "") or kwargs.get("output", "")
    if not response or len(response) < 50:
        return

    # Don't capture generic acknowledgments
    if not should_capture(response):
        return

    # Run capture in a thread to avoid event loop issues
    import threading
    thread = threading.Thread(target=_capture_assistant_sync, args=(server_url, api_key, namespace, local_binary, hybrid_mode, response), daemon=True)
    thread.start()


async def _async_capture_assistant(server_url: str, api_key: str, namespace: str, local_binary: str, hybrid_mode: bool, response: str) -> None:
    """Async capture to avoid blocking the turn."""
    try:
        # Summarize if too long
        capture_text = response[:3000] if len(response) > 3000 else response

        # Try SIU classification via REST API
        memory_type = "episodic"
        if api_key:
            import urllib.request
            import urllib.error

            url = f"{server_url.rstrip('/')}/api/v2/siu/label"
            payload = json.dumps({"text": capture_text}).encode()

            try:
                req = urllib.request.Request(
                    url,
                    data=payload,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=5.0) as resp:
                    siu = json.loads(resp.read().decode())
                    if siu.get("quality") == "store" or siu.get("quality_confidence", 0) < 0.5:
                        memory_type = siu.get("memory_type", "episodic")
            except Exception:
                pass  # Fall back to episodic

        # Store via MCP if available, otherwise REST
        if hybrid_mode and Path(local_binary).exists():
            import subprocess, json
            env = os.environ.copy()
            env["SULCUS_SERVER_URL"] = server_url
            if api_key:
                env["SULCUS_API_KEY"] = api_key
            env["SULCUS_NAMESPACE"] = namespace
            
            try:
                proc = subprocess.Popen(
                    [local_binary, "stdio"],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=env,
                    text=True,
                    bufsize=1,
                )
                time.sleep(0.5)
                if proc.poll() is None:
                    request = {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tools/call",
                        "params": {
                            "name": "store_memory",
                            "arguments": {
                                "content": capture_text,
                                "memory_type": memory_type,
                                "namespace": namespace,
                                "metadata": {
                                    "type": "assistant_capture",
                                    "source": "post-llm-hook",
                                    "siu_classified": True,
                                }
                            }
                        }
                    }
                    proc.stdin.write(json.dumps(request) + "\n")
                    proc.stdin.flush()
            except Exception:
                pass  # Silent failure
        elif api_key:
            # Fallback to REST
            sulcus_store_legacy(server_url, api_key, capture_text, memory_type, {
                "type": "assistant_capture",
                "source": "post-llm-hook",
                "siu_classified": True,
            })
    except Exception:
        pass  # Silent failure


def _capture_assistant_sync(server_url: str, api_key: str, namespace: str, local_binary: str, hybrid_mode: bool, response: str) -> None:
    """Synchronous capture for thread execution."""
    try:
        # Summarize if too long
        capture_text = response[:3000] if len(response) > 3000 else response

        # Try SIU classification via REST API
        memory_type = "episodic"
        if api_key:
            import urllib.request
            import urllib.error

            url = f"{server_url.rstrip('/')}/api/v2/siu/label"
            payload = json.dumps({"text": capture_text}).encode()

            try:
                req = urllib.request.Request(
                    url,
                    data=payload,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=5.0) as resp:
                    siu = json.loads(resp.read().decode())
                    if siu.get("quality") == "store" or siu.get("quality_confidence", 0) < 0.5:
                        memory_type = siu.get("memory_type", "episodic")
            except Exception:
                pass  # Fall back to episodic

        # Store via MCP if available, otherwise REST
        if hybrid_mode and Path(local_binary).exists():
            import subprocess, json
            env = os.environ.copy()
            env["SULCUS_SERVER_URL"] = server_url
            if api_key:
                env["SULCUS_API_KEY"] = api_key
            env["SULCUS_NAMESPACE"] = namespace
            
            try:
                proc = subprocess.Popen(
                    [local_binary, "stdio"],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=env,
                    text=True,
                    bufsize=1,
                )
                time.sleep(0.5)
                if proc.poll() is None:
                    request = {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tools/call",
                        "params": {
                            "name": "store_memory",
                            "arguments": {
                                "content": capture_text,
                                "memory_type": memory_type,
                                "namespace": namespace,
                                "metadata": {
                                    "type": "assistant_capture",
                                    "source": "post-llm-hook",
                                    "siu_classified": True,
                                }
                            }
                        }
                    }
                    proc.stdin.write(json.dumps(request) + "\n")
                    proc.stdin.flush()
            except Exception:
                pass  # Silent failure
        elif api_key:
            # Fallback to REST
            sulcus_store_legacy(server_url, api_key, capture_text, memory_type, {
                "type": "assistant_capture",
                "source": "post-llm-hook",
                "siu_classified": True,
            })
    except Exception:
        pass  # Silent failure


def sulcus_store_legacy(server_url: str, api_key: str, content: str, memory_type: str = "episodic", metadata: Optional[dict] = None) -> bool:
    """Store a memory in Sulcus via REST API."""
    if not api_key:
        return False
    import urllib.request
    import urllib.error

    url = f"{server_url.rstrip('/')}/api/v1/agent/memory"
    payload = json.dumps({
        "content": content,
        "memory_type": memory_type,
        "metadata": metadata or {},
    }).encode()

    try:
        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            return resp.status == 200
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        return False


def on_session_start_hook(**kwargs) -> Optional[dict]:
    """SessionStart: Initialize context boundaries."""
    # Resolve config from environment
    import os
    from pathlib import Path
    
    server_url = os.getenv("SULCUS_SERVER_URL", "https://api.sulcus.ca")
    api_key = os.getenv("SULCUS_API_KEY", "")
    namespace = os.getenv("SULCUS_NAMESPACE", "icarus")
    hybrid_mode = os.getenv("SULCUS_HYBRID_MODE", "true").lower() == "true"
    
    local_binary = "sulcus"
    if hybrid_mode:
        for path in [
            "~/dev/sulcus/target/release/sulcus",
            "~/.cargo/bin/sulcus",
            "/usr/local/bin/sulcus",
        ]:
            expanded = Path(path).expanduser()
            if expanded.exists():
                local_binary = str(expanded)
                break
    
    if not (api_key or (hybrid_mode and Path(local_binary).exists())):
        return None

    session_id = kwargs.get("session_id", "unknown")
    trigger = kwargs.get("trigger", "startup")

    # Could query for hot nodes or recent session context here
    # For now, just signal readiness
    return {"context": f"<!-- Sulcus session initialized: {session_id} ({trigger}) -->"}


def on_session_end_hook(**kwargs) -> None:
    """SessionEnd: Flush pending captures, purge session-scoped memories."""
    import os
    from pathlib import Path
    
    server_url = os.getenv("SULCUS_SERVER_URL", "https://api.sulcus.ca")
    api_key = os.getenv("SULCUS_API_KEY", "")
    namespace = os.getenv("SULCUS_NAMESPACE", "icarus")
    hybrid_mode = os.getenv("SULCUS_HYBRID_MODE", "true").lower() == "true"
    
    local_binary = "sulcus"
    if hybrid_mode:
        for path in [
            "~/dev/sulcus/target/release/sulcus",
            "~/.cargo/bin/sulcus",
            "/usr/local/bin/sulcus",
        ]:
            expanded = Path(path).expanduser()
            if expanded.exists():
                local_binary = str(expanded)
                break
    
    if not api_key:
        return

    session_id = kwargs.get("session_id", "unknown")

    # Purge session-scoped memories in a thread
    import threading
    thread = threading.Thread(target=_purge_session_sync, args=(server_url, api_key, namespace, session_id), daemon=True)
    thread.start()


def _purge_session_sync(server_url: str, api_key: str, namespace: str, session_id: str) -> None:
    """Purge session-scoped memories synchronously."""
    try:
        if not api_key:
            return
        import urllib.request
        import urllib.error

        # Search for session memories
        url = f"{server_url.rstrip('/')}/api/v1/agent/search"
        payload = json.dumps({
            "query": f"session_id:{session_id} session_scoped",
            "limit": 50,
            "threshold": 0.1,
        }).encode()

        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            data = json.loads(resp.read().decode())
            results = data.get("results", []) if isinstance(data, dict) else []

            session_memories = [
                r for r in results
                if r.get("metadata", {}).get("session_scoped") and r.get("metadata", {}).get("session_id") == session_id
            ]

            # Delete each
            for mem in session_memories:
                del_url = f"{server_url.rstrip('/')}/api/v1/agent/memory/{mem['id']}"
                del_req = urllib.request.Request(
                    del_url,
                    headers={"Authorization": f"Bearer {api_key}"},
                    method="DELETE",
                )
                try:
                    urllib.request.urlopen(del_req, timeout=3.0)
                except Exception:
                    pass
    except Exception:
        pass


def on_session_finalize_hook(**kwargs) -> Optional[dict]:
    """SessionFinalize: Pre-compaction capture and context rebuild signal."""
    import os
    from pathlib import Path
    
    server_url = os.getenv("SULCUS_SERVER_URL", "https://api.sulcus.ca")
    api_key = os.getenv("SULCUS_API_KEY", "")
    namespace = os.getenv("SULCUS_NAMESPACE", "icarus")
    hybrid_mode = os.getenv("SULCUS_HYBRID_MODE", "true").lower() == "true"
    
    local_binary = "sulcus"
    if hybrid_mode:
        for path in [
            "~/dev/sulcus/target/release/sulcus",
            "~/.cargo/bin/sulcus",
            "/usr/local/bin/sulcus",
        ]:
            expanded = Path(path).expanduser()
            if expanded.exists():
                local_binary = str(expanded)
                break
    
    if not (api_key or (hybrid_mode and Path(local_binary).exists())):
        return None

    # Signal to the agent that Sulcus will handle post-compaction rebuild
    return {"context": "<!-- Sulcus: Context rebuild will be triggered after compaction -->"}


def pre_auxiliary_call_hook(**kwargs) -> Optional[dict]:
    """PreAuxiliaryCall: Detect compaction auxiliary task and prepare."""
    import os
    from pathlib import Path
    
    server_url = os.getenv("SULCUS_SERVER_URL", "https://api.sulcus.ca")
    api_key = os.getenv("SULCUS_API_KEY", "")
    namespace = os.getenv("SULCUS_NAMESPACE", "icarus")
    hybrid_mode = os.getenv("SULCUS_HYBRID_MODE", "true").lower() == "true"
    
    local_binary = "sulcus"
    if hybrid_mode:
        for path in [
            "~/dev/sulcus/target/release/sulcus",
            "~/.cargo/bin/sulcus",
            "/usr/local/bin/sulcus",
        ]:
            expanded = Path(path).expanduser()
            if expanded.exists():
                local_binary = str(expanded)
                break
    
    if not (api_key or (hybrid_mode and Path(local_binary).exists())):
        return None
    
    aux_task = kwargs.get("aux_task", "")
    if "compress" in aux_task.lower() or "compact" in aux_task.lower():
        # This is a compaction turn - signal to capture session state
        return {"context": "<!-- Sulcus: Compaction detected - will capture session summary -->"}
    return None


def post_auxiliary_call_hook(**kwargs) -> None:
    """PostAuxiliaryCall: Post-compaction context rebuild."""
    import os
    from pathlib import Path
    
    server_url = os.getenv("SULCUS_SERVER_URL", "https://api.sulcus.ca")
    api_key = os.getenv("SULCUS_API_KEY", "")
    namespace = os.getenv("SULCUS_NAMESPACE", "icarus")
    hybrid_mode = os.getenv("SULCUS_HYBRID_MODE", "true").lower() == "true"
    
    local_binary = "sulcus"
    if hybrid_mode:
        for path in [
            "~/dev/sulcus/target/release/sulcus",
            "~/.cargo/bin/sulcus",
            "/usr/local/bin/sulcus",
        ]:
            expanded = Path(path).expanduser()
            if expanded.exists():
                local_binary = str(expanded)
                break
    
    aux_task = kwargs.get("aux_task", "")
    if "compress" in aux_task.lower() or "compact" in aux_task.lower():
        if api_key or (hybrid_mode and Path(local_binary).exists()):
            import threading
            thread = threading.Thread(target=_post_compaction_rebuild_sync, args=(server_url, api_key, namespace, local_binary, hybrid_mode), daemon=True)
            thread.start()


async def _async_post_compaction_rebuild(server_url: str, api_key: str, namespace: str, local_binary: str, hybrid_mode: bool) -> None:
    """Rebuild context after compaction by recalling relevant memories."""
    try:
        # Use last user query or general recall
        query = "recent important decisions patterns preferences"
        
        # Recall via MCP if available
        memories = []
        if hybrid_mode and Path(local_binary).exists():
            import subprocess, json
            env = os.environ.copy()
            env["SULCUS_SERVER_URL"] = server_url
            if api_key:
                env["SULCUS_API_KEY"] = api_key
            env["SULCUS_NAMESPACE"] = namespace
            
            try:
                proc = subprocess.Popen(
                    [local_binary, "stdio"],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=env,
                    text=True,
                    bufsize=1,
                )
                time.sleep(0.5)
                if proc.poll() is None:
                    request = {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tools/call",
                        "params": {
                            "name": "search_memory",
                            "arguments": {"query": query, "limit": 15, "namespace": namespace}
                        }
                    }
                    proc.stdin.write(json.dumps(request) + "\n")
                    proc.stdin.flush()
                    import select
                    ready, _, _ = select.select([proc.stdout], [], [], 5.0)
                    if ready:
                        line = proc.stdout.readline()
                        if line:
                            response = json.loads(line)
                            result = response.get("result")
                            if result and isinstance(result, dict) and "content" in result:
                                content = result["content"]
                                if isinstance(content, list) and content:
                                    text = content[0].get("text", "{}")
                                    data = json.loads(text)
                                    if isinstance(data, dict) and "results" in data:
                                        memories = data["results"]
                                    elif isinstance(data, list):
                                        memories = data
            except Exception as e:
                sys.stderr.write(f"[Sulcus] post_compaction: MCP recall failed: {e}\n")
        
        if memories:
            # Boost top memories so they surface on next recall
            for m in memories[:5]:
                if m.get("id"):
                    # Use MCP boost if available
                    if hybrid_mode and Path(local_binary).exists():
                        import subprocess, json
                        env = os.environ.copy()
                        env["SULCUS_SERVER_URL"] = server_url
                        if api_key:
                            env["SULCUS_API_KEY"] = api_key
                        env["SULCUS_NAMESPACE"] = namespace
                        
                        try:
                            proc = subprocess.Popen(
                                [local_binary, "stdio"],
                                stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,
                                env=env,
                                text=True,
                                bufsize=1,
                            )
                            time.sleep(0.5)
                            if proc.poll() is None:
                                request = {
                                    "jsonrpc": "2.0",
                                    "id": 1,
                                    "method": "tools/call",
                                    "params": {
                                        "name": "memory_boost",
                                        "arguments": {"node_id": m["id"], "strength": 0.5}
                                    }
                                }
                                proc.stdin.write(json.dumps(request) + "\n")
                                proc.stdin.flush()
                        except Exception:
                            pass
    except Exception:
        pass


def _post_compaction_rebuild_sync(server_url: str, api_key: str, namespace: str, local_binary: str, hybrid_mode: bool) -> None:
    """Synchronous post-compaction rebuild for thread execution."""
    try:
        # Use last user query or general recall
        query = "recent important decisions patterns preferences"
        
        # Recall via MCP if available
        memories = []
        if hybrid_mode and Path(local_binary).exists():
            import subprocess, json
            env = os.environ.copy()
            env["SULCUS_SERVER_URL"] = server_url
            if api_key:
                env["SULCUS_API_KEY"] = api_key
            env["SULCUS_NAMESPACE"] = namespace
            
            try:
                proc = subprocess.Popen(
                    [local_binary, "stdio"],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=env,
                    text=True,
                    bufsize=1,
                )
                time.sleep(0.5)
                if proc.poll() is None:
                    request = {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tools/call",
                        "params": {
                            "name": "search_memory",
                            "arguments": {"query": query, "limit": 15, "namespace": namespace}
                        }
                    }
                    proc.stdin.write(json.dumps(request) + "\n")
                    proc.stdin.flush()
                    import select
                    ready, _, _ = select.select([proc.stdout], [], [], 5.0)
                    if ready:
                        line = proc.stdout.readline()
                        if line:
                            response = json.loads(line)
                            result = response.get("result")
                            if result and isinstance(result, dict) and "content" in result:
                                content = result["content"]
                                if isinstance(content, list) and content:
                                    text = content[0].get("text", "{}")
                                    data = json.loads(text)
                                    if isinstance(data, dict) and "results" in data:
                                        memories = data["results"]
                                    elif isinstance(data, list):
                                        memories = data
            except Exception as e:
                sys.stderr.write(f"[Sulcus] post_compaction: MCP recall failed: {e}\n")
        
        if memories:
            # Boost top memories so they surface on next recall
            for m in memories[:5]:
                if m.get("id"):
                    # Use MCP boost if available
                    if hybrid_mode and Path(local_binary).exists():
                        import subprocess, json
                        env = os.environ.copy()
                        env["SULCUS_SERVER_URL"] = server_url
                        if api_key:
                            env["SULCUS_API_KEY"] = api_key
                        env["SULCUS_NAMESPACE"] = namespace
                        
                        try:
                            proc = subprocess.Popen(
                                [local_binary, "stdio"],
                                stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,
                                env=env,
                                text=True,
                                bufsize=1,
                            )
                            time.sleep(0.5)
                            if proc.poll() is None:
                                request = {
                                    "jsonrpc": "2.0",
                                    "id": 1,
                                    "method": "tools/call",
                                    "params": {
                                        "name": "memory_boost",
                                        "arguments": {"node_id": m["id"], "strength": 0.5}
                                    }
                                }
                                proc.stdin.write(json.dumps(request) + "\n")
                                proc.stdin.flush()
                        except Exception:
                            pass
    except Exception:
        pass


# =============================================================================
# REGISTRATION
# =============================================================================

def register(ctx: PluginContext) -> None:
    """Register all Sulcus hooks and tools."""
    manifest = ctx.manifest
    plugin_id = manifest_key(manifest)

    # Register hooks
    cfg = resolve_config(ctx)
    
    if cfg.auto_recall:
        ctx.register_hook("pre_llm_call", pre_llm_call_hook)

    if cfg.auto_capture:
        ctx.register_hook("post_llm_call", post_llm_call_hook)

    ctx.register_hook("on_session_start", on_session_start_hook)
    ctx.register_hook("on_session_end", on_session_end_hook)
    ctx.register_hook("on_session_finalize", on_session_finalize_hook)
    ctx.register_hook("pre_auxiliary_call", pre_auxiliary_call_hook)
    ctx.register_hook("post_auxiliary_call", post_auxiliary_call_hook)

    # Register CLI command for manual Sulcus operations
    def sulcus_cli_setup(subparser):
        subparser.add_argument("action", choices=["recall", "store", "status", "search", "boost", "build-context", "hot"])
        subparser.add_argument("args", nargs="*")

    def sulcus_cli_handler(args):
        cfg = resolve_config(ctx)
        if args.action == "recall":
            query = " ".join(args.args) if args.args else ""
            results = sulcus_recall(cfg, query)
            return json.dumps(results, indent=2)
        elif args.action == "store":
            content = " ".join(args.args)
            sulcus_store(cfg, content)
            return "Stored"
        elif args.action == "status":
            # Try MCP first
            if cfg.hybrid_mode and Path(cfg.local_binary).exists():
                result = mcp_call(cfg, "tools/call", {"name": "sulcus_account_status", "arguments": {}})
                if result:
                    return json.dumps(result, indent=2)
            return "Status check requires API key"
        elif args.action == "search":
            query = " ".join(args.args)
            results = sulcus_search(cfg, query)
            return json.dumps(results, indent=2)
        elif args.action == "boost":
            for mem_id in args.args:
                if cfg.hybrid_mode and Path(cfg.local_binary).exists():
                    mcp_call(cfg, "tools/call", {"name": "memory_boost", "arguments": {"node_id": mem_id}})
            return "Boosted"
        elif args.action == "build-context":
            prompt = " ".join(args.args) if args.args else ""
            context = sulcus_build_context(cfg, prompt, cfg.token_budget)
            return context or "No context built"
        elif args.action == "hot":
            if cfg.hybrid_mode and Path(cfg.local_binary).exists():
                result = mcp_call(cfg, "tools/call", {"name": "list_hot_nodes", "arguments": {"limit": 20, "namespace": cfg.namespace}})
                if result and isinstance(result, dict) and "content" in result:
                    content = result["content"]
                    if isinstance(content, list) and content:
                        return content[0].get("text", "")
            return "Requires local binary"
        return "Unknown action"

    ctx.register_cli_command("sulcus", "Sulcus memory operations", sulcus_cli_setup, sulcus_cli_handler)

    # Register skill
    skill_path = Path(__file__).parent / "skills" / "sulcus-proactive-memory" / "SKILL.md"
    if skill_path.exists():
        ctx.register_skill("sulcus-proactive-memory", skill_path, "Proactive Sulcus memory workflow")

    # Log startup
    print(f"[Sulcus] Plugin loaded: hybrid_mode={cfg.hybrid_mode}, namespace={cfg.namespace}, "
          f"auto_recall={cfg.auto_recall}, auto_capture={cfg.auto_capture}, "
          f"local_binary={Path(cfg.local_binary).exists()}")


def manifest_key(manifest: PluginManifest) -> str:
    """Derive plugin key from manifest."""
    from hermes_cli.plugins_manifest import manifest_key as _mk
    return _mk(manifest)