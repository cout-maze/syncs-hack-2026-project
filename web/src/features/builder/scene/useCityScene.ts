import { useSyncExternalStore } from 'react';
import {
  getCityScene,
  getCouncilScene,
  subscribeToCityScene,
  subscribeToCouncilScene,
  type CitySceneApi,
} from './sceneApi';

/**
 * Read the live map handle from any feature.
 *
 * Returns null while the map workspace is not mounted, so always null-check before
 * driving an animation:
 *
 *   const scene = useCityScene();
 *   scene?.highlightPath(journey.pathBlockIds);
 */
export function useCityScene(): CitySceneApi | null {
  return useSyncExternalStore(subscribeToCityScene, getCityScene, () => null);
}

/** Same as `useCityScene()`, but for the council map shown in Proposal mode. */
export function useCouncilScene(): CitySceneApi | null {
  return useSyncExternalStore(subscribeToCouncilScene, getCouncilScene, () => null);
}
