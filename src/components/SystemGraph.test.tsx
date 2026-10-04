import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  computeLayout,
  computeRadialLayout,
  kindFromSecurity,
  RADIAL_STEP,
} from "./systemGraphLayout";
import {
  SystemGraph,
  type SystemGraphEdge,
  type SystemGraphNode,
} from "./SystemGraph";

describe("SystemGraph.computeLayout", () => {
  it("lays a connected chain out in BFS columns from the root", () => {
    const nodes: SystemGraphNode[] = [
      { id: "a", label: "A", kind: "hisec" },
      { id: "b", label: "B", kind: "lowsec" },
      { id: "c", label: "C", kind: "wspace" },
    ];
    const edges: SystemGraphEdge[] = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const pos = computeLayout(nodes, edges, "a");
    // Depth increases left→right along the chain.
    expect(pos.get("a")!.x).toBeLessThan(pos.get("b")!.x);
    expect(pos.get("b")!.x).toBeLessThan(pos.get("c")!.x);
    expect(pos.get("a")).toEqual({ x: 0, y: 0 });
  });

  it("stacks disconnected components rather than overlapping them", () => {
    const nodes: SystemGraphNode[] = [
      { id: "a", label: "A", kind: "hisec" },
      { id: "b", label: "B", kind: "hisec" },
    ];
    // No edges → two separate components at depth 0, different rows.
    const pos = computeLayout(nodes, []);
    expect(pos.get("a")!.x).toBe(pos.get("b")!.x);
    expect(pos.get("a")!.y).not.toBe(pos.get("b")!.y);
  });

  it("positions every node exactly once", () => {
    const nodes: SystemGraphNode[] = [
      { id: "a", label: "A", kind: "hisec" },
      { id: "b", label: "B", kind: "hisec" },
      { id: "c", label: "C", kind: "hisec" },
    ];
    const pos = computeLayout(nodes, [{ source: "a", target: "b" }]);
    expect(pos.size).toBe(3);
  });
});

describe("SystemGraph.computeRadialLayout", () => {
  it("places the root at the origin and each BFS depth on its own ring", () => {
    const nodes: SystemGraphNode[] = [
      { id: "root", label: "Root", kind: "hisec" },
      { id: "a", label: "A", kind: "hisec" },
      { id: "b", label: "B", kind: "hisec" },
    ];
    const edges: SystemGraphEdge[] = [
      { source: "root", target: "a" },
      { source: "a", target: "b" },
    ];
    const pos = computeRadialLayout(nodes, edges, "root");
    expect(pos.get("root")).toEqual({ x: 0, y: 0 });
    const distA = Math.hypot(pos.get("a")!.x, pos.get("a")!.y);
    const distB = Math.hypot(pos.get("b")!.x, pos.get("b")!.y);
    expect(distA).toBeCloseTo(RADIAL_STEP);
    expect(distB).toBeCloseTo(RADIAL_STEP * 2);
  });

  it("gives a bigger subtree a proportionally wider angular wedge", () => {
    // root → a (leaf, subtree size 1) and root → b → b1 (b's subtree size
    // 2). Total weight 3: a's wedge is [0, 2π/3) (mid π/3), visited first
    // per edge order; b's wedge follows at [2π/3, 2π) (mid 4π/3) — twice as
    // wide since its subtree is twice the size. b1 inherits b's full wedge
    // (its only child) one ring further out.
    const nodes: SystemGraphNode[] = [
      { id: "root", label: "Root", kind: "hisec" },
      { id: "a", label: "A", kind: "hisec" },
      { id: "b", label: "B", kind: "hisec" },
      { id: "b1", label: "B1", kind: "hisec" },
    ];
    const edges: SystemGraphEdge[] = [
      { source: "root", target: "a" },
      { source: "root", target: "b" },
      { source: "b", target: "b1" },
    ];
    const pos = computeRadialLayout(nodes, edges, "root");
    const angleA = Math.PI / 3;
    const angleB = (4 * Math.PI) / 3;
    expect(pos.get("a")!.x).toBeCloseTo(RADIAL_STEP * Math.cos(angleA));
    expect(pos.get("a")!.y).toBeCloseTo(RADIAL_STEP * Math.sin(angleA));
    expect(pos.get("b")!.x).toBeCloseTo(RADIAL_STEP * Math.cos(angleB));
    expect(pos.get("b")!.y).toBeCloseTo(RADIAL_STEP * Math.sin(angleB));
    expect(pos.get("b1")!.x).toBeCloseTo(2 * RADIAL_STEP * Math.cos(angleB));
    expect(pos.get("b1")!.y).toBeCloseTo(2 * RADIAL_STEP * Math.sin(angleB));
  });

  it("falls back to the plain BFS layout when rootId is absent or unknown", () => {
    const nodes: SystemGraphNode[] = [
      { id: "a", label: "A", kind: "hisec" },
      { id: "b", label: "B", kind: "hisec" },
    ];
    const edges: SystemGraphEdge[] = [{ source: "a", target: "b" }];
    expect(computeRadialLayout(nodes, edges)).toEqual(
      computeLayout(nodes, edges),
    );
    expect(computeRadialLayout(nodes, edges, "nope")).toEqual(
      computeLayout(nodes, edges, "nope"),
    );
  });

  it("offsets a node unreachable from the root below the rings instead of overlapping them", () => {
    const nodes: SystemGraphNode[] = [
      { id: "root", label: "Root", kind: "hisec" },
      { id: "a", label: "A", kind: "hisec" },
      { id: "stray", label: "Stray", kind: "hisec" },
    ];
    const edges: SystemGraphEdge[] = [{ source: "root", target: "a" }];
    const pos = computeRadialLayout(nodes, edges, "root");
    expect(pos.get("stray")).not.toEqual(pos.get("root"));
    expect(pos.get("stray")).not.toEqual(pos.get("a"));
    expect(pos.get("stray")!.y).toBeGreaterThan(RADIAL_STEP);
  });

  it("positions every node exactly once", () => {
    const nodes: SystemGraphNode[] = [
      { id: "root", label: "Root", kind: "hisec" },
      { id: "a", label: "A", kind: "hisec" },
      { id: "b", label: "B", kind: "hisec" },
    ];
    const edges: SystemGraphEdge[] = [
      { source: "root", target: "a" },
      { source: "root", target: "b" },
    ];
    expect(computeRadialLayout(nodes, edges, "root").size).toBe(3);
  });
});

describe("SystemGraph layout picker", () => {
  const nodes: SystemGraphNode[] = [
    { id: "a", label: "Alpha", kind: "hisec", x: 0, y: 0 },
    { id: "b", label: "Beta", kind: "hisec", x: 100, y: 0 },
  ];
  const edges: SystemGraphEdge[] = [{ source: "a", target: "b" }];

  it("offers the Center layout only when a root system is given", () => {
    const { rerender } = render(
      <SystemGraph nodes={nodes} edges={edges} height={300} />,
    );
    expect(screen.queryByTitle("Center layout")).not.toBeInTheDocument();

    rerender(
      <SystemGraph nodes={nodes} edges={edges} rootId="a" height={300} />,
    );
    expect(screen.getByTitle("Center layout")).toBeInTheDocument();
  });
});

describe("SystemGraph.kindFromSecurity", () => {
  it("bands security into hi/low/null", () => {
    expect(kindFromSecurity(0.9)).toBe("hisec");
    expect(kindFromSecurity(0.5)).toBe("hisec");
    // True sec 0.45–0.4999 displays as 0.5 in game and is high-sec.
    expect(kindFromSecurity(0.45)).toBe("hisec");
    expect(kindFromSecurity(0.4499)).toBe("lowsec");
    expect(kindFromSecurity(0.3)).toBe("lowsec");
    expect(kindFromSecurity(0.0)).toBe("nullsec");
    expect(kindFromSecurity(-0.5)).toBe("nullsec");
  });
});
