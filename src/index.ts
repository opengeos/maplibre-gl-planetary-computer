// Import styles
import './lib/styles/planetary-computer.css';

// Main control export
export { PlanetaryComputerControl } from './lib/core/PlanetaryComputerControl';
export { LayerManager } from './lib/core/LayerManager';

// Adapter export
export { PlanetaryComputerLayerAdapter } from './lib/adapters/PlanetaryComputerLayerAdapter';

// Core type exports
export type {
  PlanetaryComputerOptions,
  PlanetaryComputerState,
  PlanetaryComputerEvent,
  PlanetaryComputerEventHandler,
  PlanetaryComputerEventData,
  ActiveLayer,
  PanelView,
  LayerPlacementOptions,
  AddItemLayerOptions,
  AddMosaicLayerOptions,
  PlanetaryComputerCustomAction,
  PlanetaryComputerCustomActions,
  SearchActionContext,
  ResultsActionContext,
  ItemActionContext,
  LayerActionContext,
} from './lib/core/types';

// API client exports
export { STACClient, buildStacSearchQuery } from './lib/api/stac-client';
export type { STACClientOptions } from './lib/api/stac-client';
export { TiTilerClient, buildMosaicSearchBody } from './lib/api/titiler-client';
export { SASTokenManager } from './lib/api/sas-token';

// Render presets exports
export {
  RENDER_CONFIGS,
  getRenderConfig,
  getPresetsForCollection,
  getDefaultPreset,
  getPreset,
} from './lib/api/render-presets';

// API type exports
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
  SASTokenResponse,
  TileJSONMetadata,
  StatisticsParams,
  BandStatistics,
  PointValueResponse,
} from './lib/api/types';

// Utility exports
export {
  generateId,
  debounce,
  throttle,
  clamp,
  formatDate,
  formatDateTime,
  truncate,
  formatBbox,
  classNames,
  isValidBbox,
  formatFileSize,
} from './lib/utils/helpers';
