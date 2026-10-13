"""SulcusSaver — LangGraph checkpointer backed by Sulcus."""

import base64
import json
from typing import Any, Dict, Iterator, Optional, Sequence, Tuple

from langgraph.checkpoint.base import (
    BaseCheckpointSaver,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
    SerializerProtocol,
)
from langchain_core.runnables import RunnableConfig

from sulcus import Sulcus

TAG_PREFIX = "__sulcus_checkpoint__"

class SulcusSaver(BaseCheckpointSaver):
    """A LangGraph checkpointer that stores state in Sulcus memory nodes.
    
    Args:
        client: An initialised sulcus.Sulcus instance.
        namespace_prefix: Prefix for namespaces used to store checkpoints.
                          Thread IDs will be appended to this.
    """
    
    def __init__(self, client: Sulcus, namespace_prefix: str = "checkpoints:", serde: Optional[SerializerProtocol] = None):
        super().__init__(serde=serde)
        self.client = client
        self.namespace_prefix = namespace_prefix

    def _get_namespace(self, thread_id: str) -> str:
        return f"{self.namespace_prefix}{thread_id}"

    def put(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: Any,
    ) -> RunnableConfig:
        """Store a checkpoint."""
        thread_id = config["configurable"]["thread_id"]
        checkpoint_id = checkpoint["id"]
        
        # Serialize checkpoint and metadata
        chk_bytes = self.serde.dumps(checkpoint)
        meta_bytes = self.serde.dumps(metadata)
        
        # Encode as base64 strings
        chk_b64 = base64.b64encode(chk_bytes).decode("utf-8")
        meta_b64 = base64.b64encode(meta_bytes).decode("utf-8")
        
        # We store the checkpoint as a node where the label contains the base64 encoded data
        payload = json.dumps({
            "checkpoint_id": checkpoint_id,
            "chk_b64": chk_b64,
            "meta_b64": meta_b64
        })
        
        pointer = f"{TAG_PREFIX}::{checkpoint_id}::{payload}"
        
        # Store in Sulcus
        self.client.remember(
            content=pointer,
            memory_type="procedural",
            heat=1.0,
            is_pinned=True, # Prevent it from being pruned
            namespace=self._get_namespace(thread_id)
        )
        
        return {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_ns": config["configurable"].get("checkpoint_ns", ""),
                "checkpoint_id": checkpoint_id,
            }
        }

    def put_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[Tuple[str, Any]],
        task_id: str,
    ) -> None:
        """Store pending writes for a checkpoint."""
        thread_id = config["configurable"]["thread_id"]
        checkpoint_id = config["configurable"]["checkpoint_id"]
        
        # Serialize writes
        serialized_writes = [
            (channel, base64.b64encode(self.serde.dumps(val)).decode("utf-8"))
            for channel, val in writes
        ]
        
        payload = json.dumps({
            "task_id": task_id,
            "writes": serialized_writes
        })
        
        pointer = f"{TAG_PREFIX}_writes::{checkpoint_id}::{task_id}::{payload}"
        
        self.client.remember(
            content=pointer,
            memory_type="procedural",
            heat=1.0,
            is_pinned=True,
            namespace=self._get_namespace(thread_id)
        )

    def get_tuple(self, config: RunnableConfig) -> Optional[CheckpointTuple]:
        """Get a checkpoint tuple."""
        thread_id = config["configurable"]["thread_id"]
        checkpoint_id = config["configurable"].get("checkpoint_id")
        
        ns = self._get_namespace(thread_id)
        
        nodes = self.client.list(
            namespace=ns,
            memory_type="procedural",
            page_size=100,
            sort="updated_at",
            order="desc"
        )
        
        # Filter for checkpoints
        checkpoints = []
        for node in nodes:
            if node.pointer_summary.startswith(f"{TAG_PREFIX}::"):
                parts = node.pointer_summary.split("::", 2)
                if len(parts) == 3:
                    checkpoints.append((parts[1], parts[2]))
                    
        if not checkpoints:
            return None
            
        if checkpoint_id:
            # Find specific checkpoint
            target = next((payload for cid, payload in checkpoints if cid == checkpoint_id), None)
            if not target:
                return None
            payload_str = target
        else:
            # Get latest
            payload_str = checkpoints[0][1]
            
        payload = json.loads(payload_str)
        
        chk_bytes = base64.b64decode(payload["chk_b64"])
        meta_bytes = base64.b64decode(payload["meta_b64"])
        
        checkpoint = self.serde.loads(chk_bytes)
        metadata = self.serde.loads(meta_bytes)
        
        # Now load writes
        writes_nodes = []
        for node in nodes:
            if node.pointer_summary.startswith(f"{TAG_PREFIX}_writes::{checkpoint['id']}::"):
                parts = node.pointer_summary.split("::", 3)
                if len(parts) == 4:
                    writes_nodes.append(parts[3])
                    
        pending_writes = []
        for wn in writes_nodes:
            wp = json.loads(wn)
            task_id = wp["task_id"]
            for channel, b64_val in wp["writes"]:
                val = self.serde.loads(base64.b64decode(b64_val))
                pending_writes.append((task_id, channel, val))
                
        return CheckpointTuple(
            config=config,
            checkpoint=checkpoint,
            metadata=metadata,
            pending_writes=pending_writes,
            parent_config=None # simplified
        )

    def list(
        self,
        config: Optional[RunnableConfig],
        *,
        filter: Optional[Dict[str, Any]] = None,
        before: Optional[RunnableConfig] = None,
        limit: Optional[int] = None,
    ) -> Iterator[CheckpointTuple]:
        """List checkpoints."""
        if not config or "thread_id" not in config.get("configurable", {}):
            return iter([])
            
        thread_id = config["configurable"]["thread_id"]
        ns = self._get_namespace(thread_id)
        
        nodes = self.client.list(
            namespace=ns,
            memory_type="procedural",
            page_size=limit or 100,
            sort="updated_at",
            order="desc"
        )
        
        # Group writes by checkpoint
        writes_by_chk = {}
        for node in nodes:
            if node.pointer_summary.startswith(f"{TAG_PREFIX}_writes::"):
                parts = node.pointer_summary.split("::", 3)
                if len(parts) == 4:
                    cid = parts[1]
                    if cid not in writes_by_chk:
                        writes_by_chk[cid] = []
                    wp = json.loads(parts[3])
                    task_id = wp["task_id"]
                    for channel, b64_val in wp["writes"]:
                        val = self.serde.loads(base64.b64decode(b64_val))
                        writes_by_chk[cid].append((task_id, channel, val))
        
        yielded = 0
        for node in nodes:
            if node.pointer_summary.startswith(f"{TAG_PREFIX}::"):
                parts = node.pointer_summary.split("::", 2)
                if len(parts) == 3:
                    cid = parts[1]
                    payload = json.loads(parts[2])
                    chk_bytes = base64.b64decode(payload["chk_b64"])
                    meta_bytes = base64.b64decode(payload["meta_b64"])
                    
                    checkpoint = self.serde.loads(chk_bytes)
                    metadata = self.serde.loads(meta_bytes)
                    
                    cfg = {
                        "configurable": {
                            "thread_id": thread_id,
                            "checkpoint_ns": "",
                            "checkpoint_id": cid,
                        }
                    }
                    
                    yield CheckpointTuple(
                        config=cfg,
                        checkpoint=checkpoint,
                        metadata=metadata,
                        pending_writes=writes_by_chk.get(cid, []),
                        parent_config=None
                    )
                    
                    yielded += 1
                    if limit and yielded >= limit:
                        break
