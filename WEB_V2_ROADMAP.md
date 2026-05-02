# SULCUS Web V2 Roadmap

This document outlines the evolutionary steps for the SULCUS web platform, positioning it as the definitive "Supabase for AI Agents."

## 1. Feature Analysis (V2 Targets)
Compared to competitors like Supermemory, SULCUS will focus on high-scale agent fleet requirements rather than human bookmarking.

### Interactive Thermodynamic Graph
- **Objective**: Move beyond flat lists to a real interactive D3/react-force-graph.
- **Visuals**: Node size = heat score, edge opacity = causal relationship strength.
- **Interactions**: Click to "Ignite" (increase heat manually), drag to group, right-click to "Prune" (delete).

### Hierarchical Namespaces
- **Objective**: Replace flat "Spaces" with nested Organizations and Namespaces.
- **Inheritance**: Decay policies can be set at the Org level and inherited by namespaces.

### Enhanced Semantic Search
- **Threshold Sliders**: Allow users to adjust the similarity cutoff for context retrieval.
- **Re-ranking**: Expose the underlying score (0.6x cosine + 0.4x ts_rank) to the UI.

## 2. Technical Stack Upgrade
We are moving to a standardized component-driven architecture.

- [x] **Lucide React**: Integrated for consistent iconography.
- [x] **TanStack Query**: Integrated for robust data fetching and caching.
- [x] **Framer Motion**: Integrated for high-fidelity Art Deco transitions.
- [ ] **Shadcn UI**: Planned integration for accessible, themeable components.
- [ ] **TanStack Table**: Planned for complex, sortable memory management lists.

## 3. Toolset Task List

### Phase 1: Foundation (Current)
- [x] Global Auth & Query Providers.
- [x] Responsive sidebar with Lucide icons.
- [x] Dark Cyber Medical Art Deco styling baseline.

### Phase 2: Memory Management V2
- [ ] Implement `TanStack Table` for `/dashboard/memories`.
- [ ] Add batch selection checkboxes.
- [ ] Add "Batch Delete" and "Batch Heat Adjustment" buttons.
- [ ] Implement `TaggingSystem` (JSONB column in DB).

### Phase 3: Graph Visualization
- [ ] Integrate `react-force-graph-2d`.
- [ ] Map thermodynamic heat to node color/size.
- [ ] Implement live "Decay Animation" where nodes visually fade out as heat drops.

### Phase 4: Scaling & Compliance
- [ ] Enterprise Seat Management UI.
- [ ] Organization Invitation Dashboard.
- [ ] Usage/Quota Limit enforcement UI.

---
*Last Updated: 2026-03-07*
