import { describe, expect, it } from "vitest";
import {
  enemyFaction,
  isMilitiaFaction,
  militiaIdByName,
  perspectiveFor,
  relationshipFor,
  warzoneForFaction,
} from "./factionPerspective";

describe("isMilitiaFaction", () => {
  it("recognises the four militias and rejects everything else", () => {
    expect(isMilitiaFaction(500001)).toBe(true);
    expect(isMilitiaFaction(500002)).toBe(true);
    expect(isMilitiaFaction(500003)).toBe(true);
    expect(isMilitiaFaction(500004)).toBe(true);
    expect(isMilitiaFaction(500010)).toBe(false); // Guristas
    expect(isMilitiaFaction(0)).toBe(false);
  });
});

describe("warzoneForFaction", () => {
  it("groups Caldari/Gallente and Amarr/Minmatar into their warzones", () => {
    expect(warzoneForFaction(500001)).toBe("Caldari–Gallente");
    expect(warzoneForFaction(500004)).toBe("Caldari–Gallente");
    expect(warzoneForFaction(500003)).toBe("Amarr–Minmatar");
    expect(warzoneForFaction(500002)).toBe("Amarr–Minmatar");
  });
});

describe("enemyFaction", () => {
  it("pairs each militia with its warzone opponent, symmetrically", () => {
    expect(enemyFaction(500001)).toBe(500004);
    expect(enemyFaction(500004)).toBe(500001);
    expect(enemyFaction(500003)).toBe(500002);
    expect(enemyFaction(500002)).toBe(500003);
  });
});

describe("militiaIdByName", () => {
  it("resolves the four militia names", () => {
    expect(militiaIdByName("Caldari State")).toBe(500001);
    expect(militiaIdByName("Gallente Federation")).toBe(500004);
    expect(militiaIdByName("Amarr Empire")).toBe(500003);
    expect(militiaIdByName("Minmatar Republic")).toBe(500002);
  });

  it("returns null for an unrecognised name", () => {
    expect(militiaIdByName("Guristas Pirates")).toBeNull();
  });
});

describe("perspectiveFor", () => {
  it("Caldari–Gallente warzone: defend/push/neither", () => {
    // Mine (Caldari), contested → defend.
    expect(perspectiveFor(500001, "contested", 500001)).toBe("defend");
    // Enemy's (Gallente), vulnerable → push.
    expect(perspectiveFor(500004, "vulnerable", 500001)).toBe("push");
    // Mine, but uncontested → neither (nothing to act on).
    expect(perspectiveFor(500001, "uncontested", 500001)).toBeNull();
    // Enemy's, but uncontested → neither.
    expect(perspectiveFor(500004, "uncontested", 500001)).toBeNull();
  });

  it("Amarr–Minmatar warzone: defend/push/neither", () => {
    expect(perspectiveFor(500003, "captured", 500003)).toBe("defend");
    expect(perspectiveFor(500002, "contested", 500003)).toBe("push");
    expect(perspectiveFor(500002, "uncontested", 500003)).toBeNull();
  });

  it("a system in the other warzone is neither defend nor push", () => {
    // Selected militia is Caldari; system occupied by Amarr (unrelated warzone).
    expect(perspectiveFor(500003, "contested", 500001)).toBeNull();
  });
});

describe("relationshipFor", () => {
  it("buckets the occupier relative to the selected militia", () => {
    expect(relationshipFor(500001, 500001)).toBe("friendly");
    expect(relationshipFor(500004, 500001)).toBe("hostile");
    // Not mine and not my direct enemy (e.g. the other warzone, or a future
    // cartel occupier) buckets as cartel/other rather than hostile.
    expect(relationshipFor(500003, 500001)).toBe("cartel");
  });

  it("stays consistent regardless of which militia is 'mine'", () => {
    // Flip perspective to Gallente: what was friendly is now hostile.
    expect(relationshipFor(500001, 500004)).toBe("hostile");
    expect(relationshipFor(500004, 500004)).toBe("friendly");
  });
});
