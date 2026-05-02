# SULCUS Cognitive Thermodynamics Report
**Final Validation & Release Notes**

We have completed the Ralph loop integrating modern SOA cognitive models into SULCUS. Here is the final validation of the mechanisms:

## 1. Value Calculus & Decay (ACT-R Model)
*   **Previous SOA:** Most LLM frameworks (like MemGPT) do not employ autonomous thermodynamic decay. They rely entirely on manual agent paging commands which creates high cognitive load.
*   **SULCUS Upgrade:** We successfully implemented a **Wall-Clock Exponential Decay** mechanism. Decay is no longer strictly bound to `tick` counts but to true elapsed time (`Δt`), mirroring the Ebbinghaus Forgetting Curve.
*   **Thermal Stability:** SULCUS now includes a `stability` factor (analogous to synaptic strength). Every time an agent queries and retrieves a memory (via `search_memory` or `ignite`), that memory's stability is multiplied by `1.5`. Highly stable memories now decay exponentially slower than transient conversation logs, ensuring long-term "facts" are naturally favored over short-term "chatter."

## 2. Ignition & Dispersion (Spreading Activation)
*   **Previous SOA:** RAG systems return the top-K nodes with flat scores.
*   **SULCUS Upgrade:** The `ignite` function now scales the injected "heat" proportionally to the mathematical Cosine Similarity of the vector match. Highly semantic matches burn hotter, pushing them to the top of the vMMU Active Index instantly.

## 3. Consolidation (LLM-Native Compaction)
*   **Previous SOA:** Truncating text when the context window fills.
*   **SULCUS Upgrade:** We implemented an **Abstractive Summarization** pipeline. When nodes go "cold" (fall below the prune threshold), the vMMU attempts to reach out to the local LLM (e.g., via `SULCUS_LLM_URL` using Ollama) to generate a dense, semantic summary of the raw content before dropping it from RAM.
*   **Typology Prompts:** The system generates specific summarization rules depending on the `memory_type` (e.g., extracting "rules" for preferences, or "numbered steps" for procedures).

## Conclusion
SULCUS is now mathematically aligned with human cognitive memory constraints. The system provides a localized, mathematically sound vMMU that gracefully handles the exact context limitations of Claude, Gemini, and Local LLMs without relying on brittle RAG strategies.

---
*Authored: Project CTO, 2026-03-04*
