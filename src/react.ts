// React component export
export { PlanetaryComputerControlReact } from './lib/core/PlanetaryComputerControlReact';

// React hooks
export { usePlanetaryComputer } from './lib/hooks/usePlanetaryComputer';

// Re-export types for React consumers
export type {
  PlanetaryComputerOptions,
  PlanetaryComputerState,
  PlanetaryComputerReactProps,
  PlanetaryComputerEvent,
  PlanetaryComputerEventHandler,
  PlanetaryComputerEventData,
  ActiveLayer,
  PanelView,
} from './lib/core/types';

// Re-export API types
export type {
  STACCollection,
  STACCollectionsResponse,
  STACItem,
  STACItemCollection,
  STACAsset,
  STACLink,
  STACProvider,
  STACSearchParams,
  TileParams,
  RenderPreset,
  CollectionRenderConfig,
} from './lib/api/types';
