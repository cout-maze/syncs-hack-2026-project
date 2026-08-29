import { useSyncExternalStore } from 'react';
import { getCityScene, subscribeToCityScene, type CitySceneApi } from './sceneApi';

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
