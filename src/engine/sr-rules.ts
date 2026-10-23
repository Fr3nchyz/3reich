import type { PowerId } from "./types";

/** Units each Major Power may redeploy per Player Turn (Ref 11.72; spec 16 R18). */
export const SR_ALLOWANCE: Readonly<Record<PowerId, number>> = {
  usa: 10,
  germany: 9,
  britain: 7,
  ussr: 6,
  italy: 5,
  france: 5,
};

/** Each grant of this many BRPs or part uses one redeployment (Ref 11.72, 11.71; spec 16 R21). TODO(verify): AER30. */
export const SR_BRPS_PER_REDEPLOYMENT = 20;
