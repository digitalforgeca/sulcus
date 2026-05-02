# SULCUS Social Launch: Julian/Aethelgard Demo Storyboard

**Objective:** Visually demonstrate how the vMMU prevents context window overflow and maintains deterministic memory recall.

## Characters
*   **Julian:** Senior Backend Engineer (The User).
*   **Aethelgard:** Julian's SULCUS-backed AI Agent (The Mind).

## Visual Style
*   Split-screen aesthetic.
*   **Left Side:** "Legacy Context" (Red accents, high friction, red "Context Full" warnings).
*   **Right Side:** "SULCUS vMMU" (Amber/Blue accents, low friction, "paging" HUD).

---

## Frame 1: The Setup (0:00 - 0:15)
*   **Left Side:** Standard LLM interface (Claude/ChatGPT). Julian is asking about a complex EdDSA signing logic implemented 3 weeks ago.
*   **AI:** "Can you re-explain the signing decision? I've lost the earlier part of our conversation."
*   **Right Side:** Aethelgard interface with SULCUS HUD. Translucent node graph at the bottom showing 60+ nodes. 
*   **HUD:** `vMMU Status: Active | Hot Nodes: 54 | Memory Address: IndexedDB`

## Frame 2: The Stress Event (0:15 - 0:35)
*   ** Julian:** "PagerDuty is firing! We have a JWT validation failure in production."
*   **Left Side:** Julian pastes logs. The context window hits 98%. A large red banner appears: **"CONTEXT OVERFLOW: Truncating old messages."**
*   **AI:** "I've lost the context of our EdDSA conversation to make room for these logs. Please re-prompt."
*   **Right Side:** Julian pastes logs. SULCUS HUD flashes. 
*   **vMMU Animation:** 6 cold "standup" nodes turn blue and slide off-screen to the "Cold Archive". The JWT validation logic node pulses bright amber.
*   **HUD Ticker:** `paging out 6 cold nodes... paged in 1 hot node [JWT_VALIDATION_ROOT_CAUSE] · Latency: 42ms`

## Frame 3: The Wow Moment (0:35 - 0:50)
*   **Aethelgard (Right Side):** "I see the issue. On Feb 12th (Node ID: 0x4A2F), we decided to delay the public key rotation on staging. The production verifier is still looking for KEY_VERSION=1, but the logs show the signer is using VERSION=2."
*   **Julian:** "Perfect recall. Fix applied."
*   **Caption:** `Memory that cools is not lost. It pages.`

---

## Outro (0:50 - 1:00)
*   **Logo:** SULCUS (Rust Crab Logo).
*   **Text:** `vMMU for AI Agents. Local-first. Deterministic. Launching at sulcus.io.`

---

## Asset Checklist for Pass 2 (CEO)
- [ ] Record 1080p browser window of Claude.ai.
- [ ] Design "vMMU HUD" overlay (Figma/After Effects).
- [ ] Export 3 static "constellation" graphics for the Day 2 technical deep-dive.
