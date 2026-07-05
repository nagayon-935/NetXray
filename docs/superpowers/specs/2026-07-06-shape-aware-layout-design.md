# Shape-Aware Topology Layout — Design

## Problem

`useTopologyLayout.ts`'s `classifySpineLeaf()` classifies nodes into spine/leaf roles purely by graph degree: nodes with degree ≤1 are "leaf" (pinned to ELK's LAST layer), and nodes with degree ≥3 that connect to ≥2 such degree-1 nodes are "spine" (pinned to FIRST layer).

This is backwards for real spine-leaf fabrics. In a typical topology, leaf switches connect to multiple spines *and* multiple hosts (degree ≥3), while spines connect only to leaf switches (lower degree). The current heuristic classifies the leaf switches as "spine" (FIRST layer) because they touch ≥2 true degree-1 endpoints (hosts), while the actual spines fall through unclassified. The result is a visually broken layout instead of the expected three-tier host/leaf/spine stack.

## Goal

Default to an "Auto" layout mode that detects a host/leaf/spine tiered topology using `node.type` (a reliable signal already present in the IR) instead of degree heuristics, and applies the correct tiered ELK layout automatically. Manual preset buttons (`spine-leaf` / `layered` / `force`) remain available as an explicit override.

Non-goals: no special-case shape detection for small meshes/stars (e.g. 3-node triangle or hub-spoke) — those are left to the existing `layered`/`force` ELK configs, which already produce reasonable results for them.

## Design

### Tier classification (`classifyTiers`, replaces `classifySpineLeaf`)

Given `nodes` and `edges`:

- **host tier**: any node with `type === "host"`.
- **leaf tier**: any node with `type === "switch" | "router"` that has at least one direct neighbor in the host tier.
- **spine tier**: any node with `type === "switch" | "router"` that has zero host-tier neighbors and at least one leaf-tier neighbor.
- Anything else is unclassified.

A topology is considered "tiered" only if both the host tier and the leaf tier are non-empty. If not, classification is skipped entirely (no ELK layer constraints applied) and the layout falls back to the general `layered` ELK config.

When tiered, ELK layout options apply:
- spine-tier nodes → `elk.layered.layering.layerConstraint: FIRST`
- host-tier nodes → `elk.layered.layering.layerConstraint: LAST`
- leaf-tier nodes → no constraint (ELK naturally places them in a middle layer, since they connect to both FIRST-tier and LAST-tier nodes)

This reuses the existing FIRST/LAST constraint mechanism already in the codebase — no new ELK layer-constraint type is introduced.

### Auto mode

`LayoutPreset` becomes `"auto" | "spine-leaf" | "layered" | "force"`, with `"auto"` as the default.

When `"auto"` is active, `useTopologyLayout` runs `classifyTiers()` on every layout pass:
- Tiered topology detected → apply the (corrected) spine-leaf-style ELK config using the new tier classification.
- Not detected → apply the existing `layered` ELK config unmodified.

`SimToolbar`'s layout selector gains a fourth "Auto" button alongside the existing `spine-leaf` / `layered` / `force`. Clicking a manual preset pins it (overriding auto-detection) until the user clicks "Auto" again.

### Files touched

- `frontend/src/hooks/useTopologyLayout.ts` — replace `classifySpineLeaf` with `classifyTiers`; add `"auto"` handling in `applyLayout`.
- `frontend/src/components/toolbar/SimToolbar.tsx` — add "Auto" button to the layout selector; default selected state.
- Whatever store holds the current layout preset (likely local state in `TopologyCanvas.tsx` passed to `SimToolbar`/`useTopologyLayout` — to be confirmed against actual code during planning) — default value changes to `"auto"`.

### Testing

Frontend has no automated test suite (per project convention). Verification is manual: load the 3-node sample, spine-leaf sample, and any host-attached fat-tree sample via the dev server preview, confirm Auto mode produces a clean tiered layout for spine-leaf-shaped topologies and leaves other shapes to the existing `layered` fallback, and confirm manual preset buttons still override auto correctly.
