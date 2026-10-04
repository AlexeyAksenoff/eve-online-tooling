// Pure layout/colour helpers for SystemGraph, kept out of the component file so
// react-refresh can hot-reload it cleanly (and so these stay unit-testable).

import type { NodeKind, SystemGraphEdge, SystemGraphNode } from "./SystemGraph";
import { secBand } from "../lib/security";

/** Tree-layout cell size (px): column width / row height per BFS layer. */
export const COL = 190;
export const ROW = 74;

/** Map a raw SDE security value to a node kind (w-space handled by caller).
 *  Delegates to the shared `secBand` so graph nodes agree with every other
 *  surface on the round-first hisec boundary. */
export function kindFromSecurity(security: number): NodeKind {
  return secBand(security);
}

/**
 * Lay out nodes in BFS layers left→right (depth = column, siblings stacked in
 * rows). Deterministic and dependency-free — good enough for chain/trail shapes.
 * Disconnected components stack below one another. Pure.
 */
export function computeLayout(
  nodes: SystemGraphNode[],
  edges: SystemGraphEdge[],
  rootId?: string,
): Map<string, { x: number; y: number }> {
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => adj.set(n.id, []));
  edges.forEach((e) => {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }
  });

  const pos = new Map<string, { x: number; y: number }>();
  const visited = new Set<string>();
  const rowAtDepth = new Map<number, number>();

  // Visit the requested root first so it anchors the top-left.
  const order = nodes.map((n) => n.id);
  if (rootId && adj.has(rootId)) {
    order.sort((a, b) => (a === rootId ? -1 : b === rootId ? 1 : 0));
  }

  for (const start of order) {
    if (visited.has(start)) continue;
    const queue: [string, number][] = [[start, 0]];
    visited.add(start);
    while (queue.length) {
      const [id, depth] = queue.shift()!;
      const row = rowAtDepth.get(depth) ?? 0;
      rowAtDepth.set(depth, row + 1);
      pos.set(id, { x: depth * COL, y: row * ROW });
      for (const nb of adj.get(id) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push([nb, depth + 1]);
        }
      }
    }
  }
  return pos;
}

/** Radial step (px) between successive BFS rings in {@link computeRadialLayout}. */
export const RADIAL_STEP = 190;

/**
 * Lay nodes out as concentric rings around `rootId` (the "Center" map
 * preset): the root sits at the origin, its direct neighbours occupy the
 * first ring, their neighbours the second, and so on — BFS depth maps to
 * ring radius exactly like {@link computeLayout}'s columns, just wrapped
 * around a circle instead of laid out left→right.
 *
 * Each node's angular slice is proportional to the size of its subtree in
 * the BFS spanning tree (descendant count), recursively divided among its
 * own children — the standard radial-tree trick that keeps sibling
 * subtrees from interleaving, which in turn keeps most *tree* edges from
 * crossing. Real stargate links outside the spanning tree (cycles — most
 * constellations have more than one route between two systems) can still
 * cut across rings; this is a good heuristic for "mostly untangled", not a
 * hard planarity guarantee.
 *
 * Any node unreachable from `rootId` (a disconnected pocket, or `rootId`
 * itself absent from the graph) falls back to {@link computeLayout}'s plain
 * BFS-column position, offset below the rings so it never overlaps them.
 * Pure.
 */
export function computeRadialLayout(
  nodes: SystemGraphNode[],
  edges: SystemGraphEdge[],
  rootId?: string,
): Map<string, { x: number; y: number }> {
  const fallback = computeLayout(nodes, edges, rootId);
  if (!rootId || !nodes.some((n) => n.id === rootId)) return fallback;

  const adj = new Map<string, string[]>();
  nodes.forEach((n) => adj.set(n.id, []));
  edges.forEach((e) => {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }
  });

  // BFS spanning tree from rootId: parent/depth per node, children in
  // discovery order (stable/deterministic for a given adjacency order).
  const depth = new Map<string, number>([[rootId, 0]]);
  const children = new Map<string, string[]>();
  nodes.forEach((n) => children.set(n.id, []));
  const bfsOrder: string[] = [rootId];
  const visited = new Set([rootId]);
  for (let i = 0; i < bfsOrder.length; i++) {
    const id = bfsOrder[i];
    for (const nb of adj.get(id) ?? []) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      depth.set(nb, (depth.get(id) ?? 0) + 1);
      children.get(id)!.push(nb);
      bfsOrder.push(nb);
    }
  }

  // Subtree size (self + descendants), bottom-up: BFS discovery order is
  // non-decreasing in depth, so visiting it in reverse guarantees every
  // child is sized before the parent that needs it.
  const size = new Map<string, number>();
  for (let i = bfsOrder.length - 1; i >= 0; i--) {
    const id = bfsOrder[i];
    const kids = children.get(id) ?? [];
    size.set(id, 1 + kids.reduce((sum, c) => sum + (size.get(c) ?? 1), 0));
  }

  // Angular allocation, top-down: each node divides its own wedge among its
  // children proportional to their subtree sizes, then places each child at
  // its wedge's midpoint on the next ring out.
  const angleStart = new Map<string, number>([[rootId, 0]]);
  const angleSpan = new Map<string, number>([[rootId, 2 * Math.PI]]);
  const pos = new Map<string, { x: number; y: number }>([
    [rootId, { x: 0, y: 0 }],
  ]);
  for (const id of bfsOrder) {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) continue;
    const start = angleStart.get(id) ?? 0;
    const span = angleSpan.get(id) ?? 2 * Math.PI;
    const totalSize = kids.reduce((sum, c) => sum + (size.get(c) ?? 1), 0);
    let cursor = start;
    for (const c of kids) {
      const childSpan = (span * (size.get(c) ?? 1)) / totalSize;
      angleStart.set(c, cursor);
      angleSpan.set(c, childSpan);
      const mid = cursor + childSpan / 2;
      const r = (depth.get(c) ?? 1) * RADIAL_STEP;
      pos.set(c, { x: r * Math.cos(mid), y: r * Math.sin(mid) });
      cursor += childSpan;
    }
  }

  // Stragglers unreachable from rootId: offset well below the rings' extent
  // so they never land on top of a ring, using the fallback's own relative
  // spread for distinct positions among themselves.
  const maxRingRadius = Math.max(0, ...[...depth.values()]) * RADIAL_STEP;
  for (const n of nodes) {
    if (pos.has(n.id)) continue;
    const fb = fallback.get(n.id) ?? { x: 0, y: 0 };
    pos.set(n.id, { x: fb.x, y: maxRingRadius + RADIAL_STEP + fb.y });
  }
  return pos;
}
