import { describe, expect, it } from "vitest";
import { legalActions } from "../src/engine/actions";
import { moveOptionsFor } from "../src/engine/move-options";
import type { GameState } from "../src/engine/types";
import { onMoveKey } from "../src/ui/moveBind";
import { moveAnnouncement, moveHtml } from "../src/ui/moveView";
import { chooseStack, movableStacks, moveTargets, selectionNow, toggleTick } from "../src/ui/moveTap";
import { noteMove, revealedHidden, takeBack, takeBackReason } from "../src/ui/moveUndo";
import { run, type Session } from "../src/ui/session";
import { takeAction, tapHex } from "../src/ui/sessionActions";
import { statusHtml } from "../src/ui/statusView";
import type { WatchInfo } from "../src/ui/watchController";
import { realPositions, type Position } from "./helpers-positions";
import { at6f, inf } from "./helpers-move";
import { crafted as craftedGame, sessionAt, withUnits } from "./helpers-move-session";

// Spec 10, ticket 10-6: "Take back last move" at step 6f. A screen convenience built on replay: the engine has no undo (Ref 5.45f moves read no dice).
/** The crafted position with an empty log whose colours are empty too (the helper empties the log but not the colours kept beside it). */
const crafted = (): Session => Object.assign(craftedGame(), { logSides: undefined });
const hexOf = (s: Session, id: string) => s.ctx.map.hexes[id]!;
const at = (s: Session, id: string) => s.state.units[id]!.at;
const moveInto = (s: Session, from: string, to: string, untick: string[] = []) => {
  chooseStack(s, from);
  for (const id of untick) toggleTick(s, id);
  tapHex(s, hexOf(s, to));
};
const same = (a: Session, b: Session) => {
  expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  expect(a.log).toEqual(b.log);
  expect([...(a.logSides ?? [])]).toEqual([...(b.logSides ?? [])]);
};
const snapshot = (s: Session) => ({ state: s.state, log: [...s.log], sides: [...(s.logSides ?? [])] });

describe("taking back the last move", () => {
  it("restores the exact earlier position and cuts the log: after 1, 2 and 3 moves", () => {
    const s = crafted();
    const shots = [snapshot(s)];
    moveInto(s, "L32", "K33", ["u2"]); // u1 to L33
    shots.push(snapshot(s));
    moveInto(s, "L32", "K32"); // u2 alone
    shots.push(snapshot(s));
    moveInto(s, "L33", "L34");
    expect(s.log.length).toBeGreaterThanOrEqual(shots[0]!.log.length + 3); // a move line each, and a line when a hex changes hands
    for (let i = 2; i >= 0; i--) {
      expect(takeBackReason(s)).toBeNull();
      expect(takeBack(s)).toBe(true);
      expect(s.state).toEqual(shots[i]!.state);
      expect(s.log).toEqual(shots[i]!.log);
      expect([...(s.logSides ?? [])]).toEqual(shots[i]!.sides);
    }
    expect(takeBack(s)).toBe(false);
    expect(takeBackReason(s)).toMatch(/^Nothing to take back/);
  });

  it("each press takes back one more move and the moved units are free to move again", () => {
    const s = crafted();
    moveInto(s, "L32", "K33", ["u2"]);
    expect(at(s, "u1")).toBe("K33");
    takeBack(s);
    expect(at(s, "u1")).toBe("L32");
    expect(movableStacks(s).map((k) => k.hex)).toEqual(["L32", "L33"]);
    expect(s.moveChosen).toBeNull();
  });

  it("says in words what was taken back, with no unit id, and speaks it", () => {
    const s = crafted();
    moveInto(s, "L32", "K33", ["u2"]);
    const told = s.log.find((l) => / move from /.test(l))!;
    takeBack(s);
    expect(s.toast).toMatch(/^Took back: Moved 3-4 German infantry from .*L32 to .*\(K33\)\.$/);
    expect(s.toast).not.toMatch(/\bu\d+\b/);
    expect(told).toMatch(/^3-4 German infantry move from/);
    expect(moveAnnouncement(s)).toBe(s.toast);
    s.toast = "";
    expect(moveAnnouncement(s)).toBe("");
  });

  it("the move's log line goes, and so does its colour; lines before it keep theirs", () => {
    const s = crafted();
    moveInto(s, "L32", "K33", ["u2"]);
    const lines = s.log.length;
    expect(s.logSides?.has(lines - 1)).toBe(true);
    moveInto(s, "L32", "K32");
    takeBack(s);
    expect(s.log.length).toBe(lines);
    expect(s.logSides?.has(lines)).toBe(false);
    expect(s.logSides?.has(lines - 1)).toBe(true);
    takeBack(s);
    expect([...(s.logSides?.keys() ?? [])].every((i) => i < s.log.length)).toBe(true);
  });

  it("a take back followed by the same move is the same game as never having taken back", () => {
    const a = crafted();
    const b = crafted();
    moveInto(a, "L32", "K33", ["u2"]);
    moveInto(b, "L32", "K33", ["u2"]);
    moveInto(a, "L32", "K32");
    takeBack(a);
    moveInto(a, "L32", "K32");
    moveInto(b, "L32", "K32");
    same(a, b);
  });
});

describe("what clears or blocks it", () => {
  it("nothing moved yet: the button has a plain reason; it never says an id", () => {
    const s = crafted();
    expect(takeBackReason(s)).toBe("Nothing to take back: no move made yet.");
    expect(takeBack(s)).toBe(false);
  });

  it("any step button that is not a move clears it, and the history never reaches the next step", () => {
    const s = crafted();
    moveInto(s, "L32", "K33", ["u2"]);
    takeAction(s, legalActions(s.ctx, s.state).find((a) => a.type === "END_STEP")!);
    expect(takeBack(s)).toBe(false);
    expect(s.undo ?? null).toBeNull();
  });

  it("an action that changes the game behind the history's back kills it (any other action of the player)", () => {
    const s = crafted();
    moveInto(s, "L32", "K33", ["u2"]);
    const end = legalActions(s.ctx, s.state).find((a) => a.type === "END_STEP")!;
    expect(run(s, end)).toBe(true); // straight through `run`, not through a button
    expect(takeBack(s)).toBe(false);
    expect(takeBackReason(s)).not.toBeNull();
  });

  it("a move that read a die cannot be taken back, nor anything before it (the safer reading of 'hidden information')", () => {
    const s = crafted();
    const before: GameState = s.state;
    expect(revealedHidden(before, { ...before, rngState: before.rngState + 1 })).toBe(true);
    expect(revealedHidden(before, before)).toBe(false);
  });

  it("a move that rolled a die is recorded as the new start: nothing before it can be taken back, a move after it can", () => {
    const s = crafted();
    moveInto(s, "L32", "K33", ["u2"]);
    const [before, logLen] = [s.state, s.log.length];
    const action = { type: "MOVE" as const, side: before.activeSide, units: ["u3"], path: ["L34"] };
    s.state = { ...before, rngState: before.rngState + 1 }; // as if the engine had read a die for this move
    noteMove(s, before, logLen, action, "Moved something.");
    expect(takeBackReason(s)).toBe("A die was rolled: earlier moves cannot be taken back.");
    expect(takeBack(s)).toBe(false);
    moveInto(s, "L32", "K32");
    expect(takeBackReason(s)).toBeNull();
    expect(takeBack(s)).toBe(true);
    expect(takeBackReason(s)).toMatch(/^A die was rolled/);
  });

  it("not available to a watched game or on the computer's turn", () => {
    const w = crafted();
    moveInto(w, "L32", "K33", ["u2"]);
    w.watch = { speed: "normal" } as unknown as WatchInfo;
    expect(takeBack(w)).toBe(false);
    expect(moveHtml(w, legalActions(w.ctx, w.state))).toBe("");
    const c = crafted();
    moveInto(c, "L32", "K33", ["u2"]);
    c.humanSide = "allies"; // the Axis turn is now the computer's
    expect(takeBack(c)).toBe(false);
    expect(moveHtml(c, [])).toBe("");
  });

  it("a mis-built history never leaves a half-built game: an unreplayable step is refused and the position stays", () => {
    const s = crafted();
    moveInto(s, "L32", "K33", ["u2"]);
    moveInto(s, "L32", "K32");
    const before = s.state;
    s.undo!.steps[0] = { ...s.undo!.steps[0]!, action: { ...s.undo!.steps[0]!.action, units: ["nobody"] } };
    expect(takeBack(s)).toBe(false);
    expect(s.state).toBe(before);
  });

  it("the choice made before a take back is gone after it, so the old yellow hexes cannot be tapped by mistake", () => {
    const s = crafted();
    moveInto(s, "L32", "K33", ["u2"]);
    expect(s.moveChosen).not.toBeNull();
    takeBack(s);
    expect(selectionNow(s)).toBeNull();
    expect(moveTargets(s)).toEqual([]);
  });
});

describe("the button on the page", () => {
  const page = (s: Session) => statusHtml(s, null, legalActions(s.ctx, s.state));

  it("is there at step 6f, greyed with its reason, then lit with the move it would undo", () => {
    const s = crafted();
    let html = page(s);
    expect(html).toContain('id="move-undo"');
    expect(html).toMatch(/id="move-undo"[^>]*aria-disabled="true"/);
    expect(html).toContain("Nothing to take back: no move made yet.");
    moveInto(s, "L32", "K33", ["u2"]);
    html = page(s);
    expect(html).not.toMatch(/id="move-undo"[^>]*aria-disabled/);
    expect(html).toMatch(/Last move: Moved 3-4 German infantry from/);
    expect(html).toContain("Take back last move");
  });

  it("stays when the last unit able to move has moved (so the move can still be taken back), and is gone when there is nothing at all", () => {
    const s = withUnits([inf("u1", "germany", "L32", 3, 4)]);
    expect(moveHtml(s, [])).toBe("");
    moveInto(s, "L32", "L33");
    const actions = legalActions(s.ctx, s.state);
    expect(actions.some((a) => a.type === "MOVE")).toBe(false);
    expect(moveHtml(s, actions)).toContain('id="move-undo"');
    takeBack(s);
    expect(at(s, "u1")).toBe("L32");
  });

  it("is not on the page at another step or in setup", () => {
    const s = crafted();
    s.state = at6f([inf("u1", "germany", "L32", 3, 4)]);
    s.state = { ...s.state, position: { part: "player-turn", turn: 1, step: "7h" } };
    expect(page(s)).not.toContain("move-undo");
  });

  it("has no raw ids in its words", () => {
    const s = crafted();
    moveInto(s, "L32", "K33", ["u2"]);
    expect(moveHtml(s, legalActions(s.ctx, s.state)).replace(/data-[a-z]+="[^"]*"|id="[^"]*"/g, "")).not.toMatch(/\bu\d+\b/);
  });

  it("Escape in the card is not a take back (only the button is)", () => {
    const s = crafted();
    moveInto(s, "L32", "K33", ["u2"]);
    onMoveKey(s, "Escape");
    expect(at(s, "u1")).toBe("K33");
  });
});

// A seeded random generator, so a failure replays.
const lcg = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);

/** A copy of a session at the same position, so the oracle replays from where the run started. */
const fork = (s: Session): Session => ({ ...s, log: [...s.log], logSides: new Map(s.logSides ?? []), moveChosen: null, undo: null, toast: "" });

/** One random move through the tap flow: a random stack, a random subset ticked, a random yellow hex. Returns the action it made, or null. */
function randomMove(s: Session, rnd: () => number): { units: string[]; path: string[] } | null {
  const stacks = movableStacks(s);
  if (stacks.length === 0) return null;
  const pick = stacks[Math.floor(rnd() * stacks.length)]!;
  chooseStack(s, pick.hex);
  for (const l of selectionNow(s)?.lines ?? []) if (l.state !== "greyed" && rnd() < 0.3) toggleTick(s, l.key);
  const sel = selectionNow(s);
  const mine = new Set(stacks.map((k) => k.hex));
  const dests = (sel?.destinations ?? []).filter((d) => !mine.has(d.to));
  if (!sel || sel.ticked.length === 0 || dests.length === 0) return null;
  const d = dests[Math.floor(rnd() * dests.length)]!;
  const before = s.state;
  tapHex(s, hexOf(s, d.to));
  return s.state === before ? null : { units: [...sel.ticked], path: d.path };
}

describe("property: random moves and take backs over real positions equal the replay of the surviving moves", () => {
  const positions: Position[] = realPositions([1], 2, 3);
  it("has real positions from all scenarios to work on", () => expect(positions.length).toBeGreaterThanOrEqual(8));

  it("state (rngState included), log and log colours are byte for byte those of a game that only made the surviving moves", () => {
    let undone = 0;
    let made = 0;
    positions.forEach((p, n) => {
      const rnd = lcg(7 + n);
      const s = sessionAt(p);
      const start = fork(s);
      const alive: { units: string[]; path: string[] }[] = [];
      for (let step = 0; step < 14; step++) {
        if (alive.length > 0 && rnd() < 0.4) {
          expect(takeBackReason(s), p.label).toBeNull();
          expect(takeBack(s), p.label).toBe(true);
          alive.pop();
          undone++;
        } else {
          const m = randomMove(s, rnd);
          if (m) { alive.push(m); made++; }
          else s.moveChosen = null;
        }
        const oracle = fork(start);
        for (const m of alive) expect(run(oracle, { type: "MOVE", side: oracle.state.activeSide, units: m.units, path: m.path }), p.label).toBe(true);
        same(s, oracle);
        expect(takeBackReason(s) === null, p.label).toBe(alive.length > 0);
      }
    });
    expect(made).toBeGreaterThan(20);
    expect(undone).toBeGreaterThan(8);
  });

  it("every move and take back leaves a position the engine still lists moves for, with no die read", () => {
    const p = positions[0]!;
    const s = sessionAt(p);
    const rng = s.state.rngState;
    const rnd = lcg(3);
    for (let i = 0; i < 6; i++) { randomMove(s, rnd); if (i % 2) takeBack(s); }
    expect(s.state.rngState).toBe(rng);
    expect(moveOptionsFor(s.ctx, s.state, [Object.values(s.state.units)[0]!.id])).toBeDefined();
  });
});
