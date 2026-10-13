import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { placementPlaces } from "../src/engine/placement";
import { currentSetupOwner, sideOfOwner } from "../src/engine/setup";
import type { ForceOwner } from "../src/engine/types";
import { createSession, currentSpec, setupView, type Session } from "../src/ui/session";
import { fillRest, finishOwner, normaliseMode, pickSpec, setMode, tapHex, undoLast } from "../src/ui/sessionActions";

const newSession = () => createSession(SCENARIO_1939, "axis", 1);
const mine = (s: Session, owner: ForceOwner) => Object.values(s.state.units).filter((u) => u.owner === owner);
const hexAt = (id: string) => MAP.hexes[id]!;

/** Where the counter that would be placed next may go. */
const places = (s: Session, owner: ForceOwner) => placementPlaces(s.ctx, s.state, owner, currentSpec(s, owner)!).filter((p) => MAP.hexes[p]);

describe("a new session", () => {
  it("starts with the computer's nations set up and one of yours waiting", () => {
    const s = newSession();
    const view = setupView(s);
    expect(s.state.phase).toBe("setup");
    expect(view).not.toBeNull();
    expect(view!.owner).toBe(currentSetupOwner(s.state));
    expect(s.humanSide).toBe("axis");
    expect(s.mode).toBe("place");
    expect(s.toast).toBe("");
    expect(s.log[0]).toContain("You play the Axis side");
  });

  it("waits for a nation of your side, whichever side you play", () => {
    const s = createSession(SCENARIO_1939, "allies", 1);
    const view = setupView(s);
    expect(view).not.toBeNull();
    expect(sideOfOwner(view!.owner)).toBe("allies");
  });
});

describe("tapping a hex during setup", () => {
  it("places the chosen counter in a legal hex", () => {
    const s = newSession();
    const owner = setupView(s)!.owner;
    const spec = currentSpec(s, owner)!;
    const at = places(s, owner)[0]!;
    tapHex(s, hexAt(at));
    const placed = mine(s, owner);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ at, type: spec.type, strength: spec.strength });
    expect(s.toast).toBe("");
  });

  it("refuses a hex where the counter cannot go, and says so", () => {
    const s = newSession();
    const owner = setupView(s)!.owner;
    const legal = new Set(places(s, owner));
    const bad = Object.keys(MAP.hexes).find((id) => !legal.has(id))!;
    tapHex(s, hexAt(bad));
    expect(mine(s, owner)).toHaveLength(0);
    expect(s.toast).toMatch(/^A \d+-factor \w+ cannot go there\. The yellow hexes are the places it can\.$/);
  });

  it("clears an old toast on the next tap", () => {
    const s = newSession();
    s.toast = "old";
    tapHex(s, hexAt(places(s, setupView(s)!.owner)[0]!));
    expect(s.toast).toBe("");
  });

  it("takes back the LAST counter of yours in a hex in remove mode, not the first", () => {
    const s = newSession();
    const owner = setupView(s)!.owner;
    // Find a hex that takes two counters.
    let stacked: string | undefined;
    for (const at of places(s, owner)) {
      const trial = newSession();
      tapHex(trial, hexAt(at));
      if (places(trial, owner).includes(at)) { stacked = at; break; }
    }
    expect(stacked, "some hex takes two counters").toBeDefined();
    tapHex(s, hexAt(stacked!));
    tapHex(s, hexAt(stacked!));
    const [first, second] = mine(s, owner);
    expect(first!.at).toBe(stacked);
    expect(second!.at).toBe(stacked);
    setMode(s, "remove");
    tapHex(s, hexAt(stacked!));
    expect(mine(s, owner).map((u) => u.id)).toEqual([first!.id]);
  });

  it("says so when there is nothing of yours to take back in that hex", () => {
    const s = newSession();
    const owner = setupView(s)!.owner;
    tapHex(s, hexAt(places(s, owner)[0]!));
    setMode(s, "remove");
    const elsewhere = Object.keys(MAP.hexes).find((id) => id !== mine(s, owner)[0]!.at)!;
    tapHex(s, hexAt(elsewhere));
    expect(mine(s, owner)).toHaveLength(1);
    expect(s.toast).toBe("You have no counter there. Tap a hex that shows one of yours.");
  });
});

describe("the setup buttons", () => {
  it("undo takes back the last counter placed, wherever it is", () => {
    const s = newSession();
    const owner = setupView(s)!.owner;
    const [a, b] = places(s, owner).filter((_, i) => i < 2) as [string, string];
    tapHex(s, hexAt(a));
    tapHex(s, hexAt(b));
    const [first, second] = mine(s, owner);
    undoLast(s, owner);
    expect(mine(s, owner).map((u) => u.id)).toEqual([first!.id]);
    expect(second!.at).toBe(b);
  });

  it("picking a counter selects it and goes back to place mode", () => {
    const s = newSession();
    const owner = setupView(s)!.owner;
    setMode(s, "remove");
    const key = `${currentSpec(s, owner)!.type}:${currentSpec(s, owner)!.strength}:`;
    pickSpec(s, key);
    expect(s.mode).toBe("place");
    expect(s.selected).toMatchObject({ type: currentSpec(s, owner)!.type });
  });

  it("falls back to place mode when there is nothing of yours to take back", () => {
    const s = newSession();
    setMode(s, "remove");
    normaliseMode(s);
    expect(s.mode).toBe("place");
    tapHex(s, hexAt(places(s, setupView(s)!.owner)[0]!));
    setMode(s, "remove");
    normaliseMode(s);
    expect(s.mode).toBe("remove");
  });

  it("'Place the rest' then 'Done' moves on to the next nation or the first turn", () => {
    const s = newSession();
    const owner = setupView(s)!.owner;
    fillRest(s);
    expect(mine(s, owner).length).toBeGreaterThan(0);
    finishOwner(s, setupView(s)?.owner ?? owner);
    for (let i = 0; i < 20 && s.state.phase === "setup"; i++) {
      const v = setupView(s);
      if (!v) break;
      fillRest(s);
      finishOwner(s, v.owner);
    }
    expect(s.state.phase).toBe("player-turn");
  });
});

describe("'Place the rest for me' after counters were placed by hand", () => {
  it("takes back the counters in the way and tells the player, instead of failing silently", () => {
    const s = createSession(SCENARIO_1939, "axis", 1);
    // Advance to Italy: it is the nation whose named placements five hand-placed 1-3s can crowd out.
    for (let i = 0; i < 20 && setupView(s)?.owner !== "italy"; i++) {
      fillRest(s);
      finishOwner(s, setupView(s)!.owner);
    }
    expect(setupView(s)?.owner).toBe("italy");
    const mainland = Object.values(MAP.hexes).filter((h) => h.land && h.country === "italy").map((h) => h.id);
    for (const at of [mainland[0]!, mainland[0]!, mainland[1]!, mainland[1]!, mainland[2]!]) {
      s.selected = { type: "infantry", strength: 1 };
      tapHex(s, hexAt(at));
    }
    expect(mine(s, "italy")).toHaveLength(5);
    fillRest(s);
    expect(s.toast).toMatch(/taken back and set down somewhere else/);
    expect(setupView(s)?.owner).not.toBe("italy");
  });
});
