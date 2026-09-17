import type { SimulationInput, SimulationResult } from "../types";

export interface ChampionPlugin {
  id: number;
  slug: string;
  patch: string;
  simulate(input: SimulationInput): SimulationResult;
}
