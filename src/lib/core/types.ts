import type { Map } from 'maplibre-gl';
import type { STACCollection, STACItem, STACSearchParams, TileParams } from '../api/types';

/**
 * Plugin configuration options.
 */
export interface PlanetaryComputerOptions {
  /**
   * Whether the control panel should start collapsed.
   * @default true
   */
  collapsed?: boolean;

  /**
   * Position of the control on the map.
   * @default 'top-right'
   */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

  /**
   * Title displayed in the control header.
   * @default 'Planetary Computer'
   */
  title?: string;

  /**
   * Width of the control panel in pixels.
   * @default 380
   */
  panelWidth?: number;

  /**
   * Custom CSS class name for the control container.
   */
  className?: string;

  /**
   * STAC API base URL.
   * @default 'https://planetarycomputer.microsoft.com/api/stac/v1'
   */
  stacApiUrl?: string;

  /**
   * TiTiler API base URL.
   * @default 'https://planetarycomputer.microsoft.com/api/data/v1'
   */
  tilerApiUrl?: string;

  /**
   * Collections to show initially (empty means show all).
   */
  defaultCollections?: string[];

  /**
   * Enable bounding box drawing tool.
   * @default true
   */
  enableBboxSelector?: boolean;

  /**
   * Maximum items per search.
   * @default 50
   */
  maxSearchResults?: number;

  /**
   * Auto-load collections on control initialization.
   * @default true
   */
  autoLoadCollections?: boolean;
}

/**
 * Active layer configuration.
 */
export interface ActiveLayer {
  /** Unique layer identifier */
  id: string;
  /** Layer type */
  type: 'item' | 'mosaic' | 'collection';
  /** MapLibre source ID */
  sourceId: string;
  /** Associated STAC item (for item layers) */
  item?: STACItem;
  /** Associated STAC collection */
  collection?: STACCollection;
  /** Mosaic search ID (for mosaic layers) */
  mosaicId?: string;
  /** Layer visibility */
  visible: boolean;
  /** Layer opacity (0-1) */
  opacity: number;
  /** Asset names used */
  assets: string[];
  /** Render parameters */
  renderParams: TileParams;
  /** Preset name if using a preset */
  presetName?: string;
}

/**
 * View states for the panel.
 */
export type PanelView = 'collections' | 'search' | 'results' | 'item' | 'layers';

/**
 * Plugin internal state.
 */
export interface PlanetaryComputerState {
  /** Panel collapsed state */
  collapsed: boolean;
  /** Panel width */
  panelWidth: number;
  /** Current panel view */
  activeView: PanelView;
  /** All available collections */
  collections: STACCollection[];
  /** Collections loading state */
  collectionsLoading: boolean;
  /** Currently selected collection */
  selectedCollection: STACCollection | null;
  /** Current search parameters */
  searchParams: STACSearchParams;
  /** Search results */
  searchResults: STACItem[];
  /** Search loading state */
  searchLoading: boolean;
  /** Currently selected item */
  selectedItem: STACItem | null;
  /** Active map layers */
  activeLayers: ActiveLayer[];
  /** Current error message */
  error: string | null;
  /** Bbox selector active */
  bboxSelectorActive: boolean;
  /** Current drawn bbox */
  drawnBbox: [number, number, number, number] | null;
}

/**
 * Plugin events.
 */
export type PlanetaryComputerEvent =
  | 'collapse'
  | 'expand'
  | 'statechange'
  | 'search'
  | 'search:start'
  | 'search:complete'
  | 'search:error'
  | 'layer:add'
  | 'layer:remove'
  | 'layer:update'
  | 'item:select'
  | 'collection:select'
  | 'collections:load'
  | 'bbox:start'
  | 'bbox:complete'
  | 'error';

/**
 * Event data structure.
 */
export interface PlanetaryComputerEventData {
  type: PlanetaryComputerEvent;
  state: PlanetaryComputerState;
  data?: unknown;
}

/**
 * Event handler type.
 */
export type PlanetaryComputerEventHandler = (event: PlanetaryComputerEventData) => void;

/**
 * React component props.
 */
export interface PlanetaryComputerReactProps extends PlanetaryComputerOptions {
  /** MapLibre GL map instance */
  map: Map;
  /** Callback fired when the control state changes */
  onStateChange?: (state: PlanetaryComputerState) => void;
  /** Callback fired when a layer is added */
  onLayerAdd?: (layer: ActiveLayer) => void;
  /** Callback fired when a layer is removed */
  onLayerRemove?: (layerId: string) => void;
  /** Callback fired when search completes */
  onSearch?: (params: STACSearchParams, results: STACItem[]) => void;
  /** Callback fired when an item is selected */
  onItemSelect?: (item: STACItem) => void;
  /** Callback fired on error */
  onError?: (error: Error) => void;
}
