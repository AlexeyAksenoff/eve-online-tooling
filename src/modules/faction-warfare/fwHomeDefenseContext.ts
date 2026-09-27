import { createContext, useContext } from "react";
import type { NearbyFlipRadius } from "./homeDefenseAlerts";

export interface FwHomeDefenseCtx {
  vulnerableAlertOn: boolean;
  setVulnerableAlertOn: (on: boolean) => void;
  nearbyFlipRadius: NearbyFlipRadius;
  setNearbyFlipRadius: (radius: NearbyFlipRadius) => void;
}

export const FwHomeDefenseContext = createContext<FwHomeDefenseCtx>({
  vulnerableAlertOn: true,
  setVulnerableAlertOn: () => {},
  nearbyFlipRadius: "5",
  setNearbyFlipRadius: () => {},
});

export function useFwHomeDefense(): FwHomeDefenseCtx {
  return useContext(FwHomeDefenseContext);
}
