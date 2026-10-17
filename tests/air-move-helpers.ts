import { syncMap } from "../src/ui/mapSync";
import type { MapView } from "../src/ui/mapView";
import type { Session } from "../src/ui/session";

/** What the map would be told for the session now: the yellow hexes, the pale ones and the marks of the planes (a fake view records the calls). */
export function mapSyncProbe(s: Session): () => { yellow: string[]; pale: string[]; marks: { from: string | null; ticked: string[]; left: string[] } } {
  return () => {
    const seen = { yellow: [] as string[], pale: [] as string[], marks: { from: null as string | null, ticked: [] as string[], left: [] as string[] } };
    const view = {
      setUnits: (_u: unknown, m: { ticked: Set<string>; left: Set<string> }) => { seen.marks.ticked = [...m.ticked]; seen.marks.left = [...m.left]; },
      setHighlights: (a: Iterable<string>, b: Iterable<string>) => { seen.yellow = [...a]; seen.pale = [...b]; },
      setAttackMarks: (m: { from?: string | null }) => { seen.marks.from = m.from ?? null; },
      clearAttackMarks: () => undefined,
      focus: () => undefined,
    } as unknown as MapView;
    syncMap(view, s, null, []);
    return seen;
  };
}
