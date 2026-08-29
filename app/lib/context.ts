"use client";

import { createContext, useContext } from "react";
import type { VesselDataProvider } from "./provider";

export const VesselContext = createContext<VesselDataProvider | null>(null);

export function useVessel(): VesselDataProvider {
  const ctx = useContext(VesselContext);
  if (!ctx) throw new Error("useVessel must be used under a provider");
  return ctx;
}
