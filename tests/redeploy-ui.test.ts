import { describe, expect, it } from "vitest";
import { moveOnAction } from "../src/engine/actions";
import type { GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { onRedeployKey } from "../src/ui/redeployBind";
import { panelOf } from "../src/ui/redeployModel";
import { chooseStack, confirmRedeploy, pickDestination, redeployTargets, selectionNow, tapToRedeploy, tickNone, toggleTick } from "../src/ui/redeployTap";
import * as T from "../src/ui/redeployText";
import { takeBackReason, takeBackRedeploy } from "../src/ui/redeployUndo";
import { redeployAnnouncement, redeployHtml } from "../src/ui/redeployView";
import type { Session } from "../src/ui/session";
import { normaliseMode, takeAction, tapHex } from "../src/ui/sessionActions";
import { statusHtml } from "../src/ui/statusView";
import { atMovement } from "./helpers-move-session";

// Spec 16 D4, D6, R25 (ticket 16-19): the Redeploy panel of step 9e. 1939 map: Berlin L31, Munich Q27, Rome Y22; Poland's M33 is next to L33.
const inf = (id: string, owner: Unit["owner"], at: string): Unit => counter(id, owner, "infantry", 2, at, 3);
const at9e = (units: Unit[], tweak: Partial<GameState> = {}): Session => {
  const s = atMovement();
  const base = board([]);
  s.state = board(units, undefined, { activeSide: "axis", position: { part: "player-turn", turn: 1, step: "9e" }, nations: { ...base.nations, italy: { ...base.nations.italy, status: "axis" } }, ...tweak });
  s.redeploy = null;
  s.srUndo = null;
  s.toast = "";
  s.log = [];
  s.logSides = undefined;
  return s;
};
const hexOf = (s: Session, id: string) => s.ctx.map.hexes[id]!;
const at = (s: Session, id: string) => s.state.units[id]!.at;
const html = (s: Session) => redeployHtml(s, moveOnAction(s.state));

describe("the panel: allowances, stacks and the reasons (D4)", () => {
  it("names each nation's allowance and lists the stacks that can go, with the units that cannot and why", () => {
    const s = at9e([inf("g1", "germany", "L31"), inf("g2", "germany", "L31"), inf("g3", "germany", "L33"), inf("p1", "poland", "M33"), inf("i1", "italy", "Y22")]);
    const out = html(s);
    expect(out).toContain("Germany 9 of 9 left.");
    expect(out).toContain("Italy 5 of 5 left.");
    expect(out).toContain('data-srstack="L31"');
    expect(out).not.toContain('data-srstack="L33"');
    expect(out).toContain("2 units can be redeployed");
    expect(out).toMatch(/Units that cannot be redeployed \(1\)/);
    expect(out).toContain(`, ${T.REASON_ENEMY}`);
    expect(out.replace(/data-sr\w+="[^"]*"/g, "")).not.toMatch(/\b[gip]\d\b/); // a unit id appears only in a data-* key
  });

  it("says a nation with nothing left cannot redeploy, and that a Replacement moves only this way", () => {
    const s = at9e([inf("g1", "germany", "L31"), counter("r1", "italy", "replacement", 1, "Y22")]);
    const lines = panelOf(s.ctx, s.state).stacks.flatMap((k) => k.lines);
    expect(lines.find((l) => l.name.includes("replacement"))!.note).toBe(T.REPLACEMENTS_NOTE);
    const spent = at9e([inf("g1", "germany", "L31"), inf("g2", "germany", "L32")]);
    spent.state = { ...spent.state, sr: { turn: `${spent.state.year}-${spent.state.season}-axis`, used: { germany: 9 }, moved: [], escorted: {} } };
    expect(panelOf(spent.ctx, spent.state).stacks.flatMap((k) => k.lines).every((l) => l.note === T.reasonNone("germany"))).toBe(true);
  });

  it("shows the panel only at the player's own step 9e", () => {
    const s = at9e([inf("g1", "germany", "L31")]);
    expect(html(s)).toContain("Redeploy");
    s.state = { ...s.state, position: { part: "player-turn", turn: 1, step: "8b" } };
    expect(html(s)).toBe("");
  });

  it("the move-on button reads 'Done with redeployment' and nothing else is a button of the list", () => {
    const s = at9e([inf("g1", "germany", "L31")]);
    const out = statusHtml(s, null, moveOnAction(s.state));
    expect(out).toContain("Done with redeployment");
    expect(out).not.toContain("SR_UNITS");
  });
});

describe("choosing, ticking and the yellow hexes", () => {
  it("choosing a stack ticks its movers; the targets are where all of them can go", () => {
    const s = at9e([inf("g1", "germany", "L31"), inf("g2", "germany", "L31")]);
    expect(chooseStack(s, "L31", true)).toBe(true);
    expect(selectionNow(s)!.ticked).toEqual(["g1", "g2"]);
    expect(redeployTargets(s)).toContain("Q27");
    expect(redeployTargets(s)).not.toContain("L31");
    expect(redeployAnnouncement(s)).toMatch(/Berlin \(L31\)\. 2 of 2 ticked\. \d+ places to go\./);
  });

  it("a map tap on a stack chooses it, a second tap on it lets it go, and a tap on empty ground says to choose first", () => {
    const s = at9e([inf("g1", "germany", "L31")]);
    tapHex(s, hexOf(s, "Q27"));
    expect(s.toast).toBe(T.CHOOSE_FIRST);
    tapHex(s, hexOf(s, "L31"));
    expect(s.redeploy?.hex).toBe("L31");
    tapHex(s, hexOf(s, "L31"));
    expect(s.redeploy).toBeNull();
  });

  it("unticking one unit leaves it behind; unticking all says to tick at least one", () => {
    const s = at9e([inf("g1", "germany", "L31"), inf("g2", "germany", "L31")]);
    chooseStack(s, "L31");
    toggleTick(s, "g2");
    expect(selectionNow(s)!.ticked).toEqual(["g1"]);
    tickNone(s);
    pickDestination(s, "Q27");
    expect(s.toast).toBe(T.NOTHING_TICKED);
  });

  it("units of different nations in one hex go together, each paying its own nation's allowance", () => {
    const s = at9e([inf("g1", "germany", "L31"), inf("i1", "italy", "L31")]);
    chooseStack(s, "L31");
    expect(selectionNow(s)!.ticked).toEqual(["g1", "i1"]);
    pickDestination(s, "Q27");
    expect(html(s)).toContain("Germany will have 8 left. Italy will have 4 left.");
    confirmRedeploy(s);
    expect(s.state.sr).toMatchObject({ used: { germany: 1, italy: 1 } });
  });

  it("ticking more units than the nation has left names the nation and says to untick", () => {
    const s = at9e([inf("g1", "germany", "L31"), inf("g2", "germany", "L31")]);
    s.state = { ...s.state, sr: { turn: `${s.state.year}-${s.state.season}-axis`, used: { germany: 8 }, moved: [], escorted: {} } };
    chooseStack(s, "L31");
    expect(selectionNow(s)!.why).toBe(T.overAllowance("germany", 1));
    expect(redeployTargets(s)).toEqual([]);
  });

  it("a hex that cannot be chosen says why: next to an enemy, open water", () => {
    const s = at9e([inf("g1", "germany", "L31"), inf("p1", "poland", "M33")]);
    chooseStack(s, "L31");
    tapHex(s, hexOf(s, "L33"));
    expect(s.toast).toBe(T.WHY_NOT_ENEMY);
    const sea = Object.values(s.ctx.map.hexes).find((h) => !h.land)!;
    tapHex(s, sea);
    expect(s.toast).toBe(T.WHY_NOT_LAND);
  });

  it("Escape throws the choice away", () => {
    const s = at9e([inf("g1", "germany", "L31")]);
    chooseStack(s, "L31");
    expect(onRedeployKey(s, "a")).toBe(false);
    expect(onRedeployKey(s, "Escape")).toBe(true);
    expect(s.redeploy).toBeNull();
  });
});

describe("the confirm card, the redeployment and taking it back (R25)", () => {
  it("a yellow hex opens the card that names the units, the places and what is left; Redeploy moves them through SR_UNITS", () => {
    const s = at9e([inf("g1", "germany", "L31"), inf("g2", "germany", "L31")]);
    chooseStack(s, "L31");
    tapHex(s, hexOf(s, "Q27"));
    expect(s.redeploy!.to).toBe("Q27");
    expect(html(s)).toContain("Redeploy 2 x 2-3 German infantry from Berlin (L31) to ");
    expect(html(s)).toContain("Germany will have 7 left.");
    confirmRedeploy(s);
    expect(at(s, "g1")).toBe("Q27");
    expect(at(s, "g2")).toBe("Q27");
    expect(s.state.sr).toMatchObject({ used: { germany: 2 }, moved: ["g1", "g2"] });
    expect(s.toast).toContain("Germany will have 7 left.");
    expect(s.log.at(-1)).toContain("Germany has 7 left");
    expect(s.redeploy).toBeNull();
  });

  it("units left in the hex stay chosen after one goes", () => {
    const s = at9e([inf("g1", "germany", "L31"), inf("g2", "germany", "L31")]);
    chooseStack(s, "L31");
    toggleTick(s, "g2");
    pickDestination(s, "Q27");
    confirmRedeploy(s);
    expect(s.redeploy).toMatchObject({ hex: "L31", ticked: ["g2"], to: null });
  });

  it("takes back the last redeployment: the exact earlier position and log, one at a time", () => {
    const s = at9e([inf("g1", "germany", "L31"), inf("g2", "germany", "L31"), inf("g3", "germany", "L32")]);
    const [state0, log0] = [s.state, [...s.log]];
    expect(takeBackReason(s)).toBe(T.UNDO_NOTHING);
    chooseStack(s, "L31");
    toggleTick(s, "g2");
    pickDestination(s, "Q27");
    confirmRedeploy(s);
    const [state1, log1] = [s.state, [...s.log]];
    chooseStack(s, "L32");
    pickDestination(s, "Q27");
    confirmRedeploy(s);
    expect(takeBackReason(s)).toBeNull();
    expect(html(s)).toContain("Last redeployment: Redeployed");
    expect(takeBackRedeploy(s)).toBe(true);
    expect(JSON.stringify(s.state)).toBe(JSON.stringify(state1));
    expect(s.log).toEqual(log1);
    expect(s.toast).toMatch(/^Took back: Redeployed /);
    expect(takeBackRedeploy(s)).toBe(true);
    expect(JSON.stringify(s.state)).toBe(JSON.stringify(state0));
    expect(s.log).toEqual(log0);
    expect(takeBackReason(s)).toBe(T.UNDO_NOTHING);
    expect(takeBackRedeploy(s)).toBe(false);
  });

  it("any other action ends what can be taken back", () => {
    const s = at9e([inf("g1", "germany", "L31"), inf("g2", "germany", "L32")]);
    chooseStack(s, "L31");
    pickDestination(s, "Q27");
    confirmRedeploy(s);
    takeAction(s, { type: "END_STEP", side: "axis", step: "9e" });
    expect(takeBackReason(s)).toBe(T.UNDO_NOTHING);
    expect(takeBackRedeploy(s)).toBe(false);
  });

  it("the choice is dropped when the step is left", () => {
    const s = at9e([inf("g1", "germany", "L31")]);
    chooseStack(s, "L31");
    takeAction(s, { type: "END_STEP", side: "axis", step: "9e" });
    normaliseMode(s);
    expect(s.redeploy).toBeNull();
    expect(tapToRedeploy(s, hexOf(s, "L31"))).toBe(false);
  });
});
