import type { Map } from 'maplibre-gl';
import type { STACCollection, STACItem, STACSearchParams, TileParams } from '../api/types';
import type { STACClient } from '../api/stac-client';
import type { TiTilerClient } from '../api/titiler-client';

/**
 * A host-supplied button rendered inside one of the panel views.
 *
 * Custom actions let an embedding application extend the panel (send search
 * results to another tool, open an item elsewhere, ...) without patching it.
 */
export interface PlanetaryComputerCustomAction<TContext> {
  /** Stable identifier, used as the button's `data-action-id`. */
  id: string;
  /** Button text. */
  label: string;
  /** Tooltip text. */
  title?: string;
  /** Hides the button when it returns false. Defaults to always visible. */
  isAvailable?: (context: TContext) => boolean;
  /** Runs when the button is clicked. A rejected promise is shown in the panel as an error. */
  onClick: (context: TContext) => void | Promise<void>;
}

/** Context passed to custom actions in the search form. */
export interface SearchActionContext {
  /** Collection being searched. */
  collection: STACCollection;
  /** Search parameters as the Search button would send them. */
  searchParams: STACSearchParams;
  /** Render parameters of the preset selected in the form, if any. */
  renderParams: TileParams;
  /** Name of the preset selected in the form, if any. */
  presetName?: string;
}

/** Context passed to custom actions in the search results list. */
export interface ResultsActionContext {
  /** Collection that was searched. */
  collection: STACCollection | null;
  /** Items returned by the search. */
  items: STACItem[];
  /** Search parameters that produced the items. */
  searchParams: STACSearchParams;
  /** Render parameters of the preset selected in the search form, if any. */
  renderParams: TileParams;
  /** Name of the preset selected in the search form, if any. */
  presetName?: string;
}

/** Context passed to custom actions in the item detail view. */
export interface ItemActionContext {
  /** Item being viewed. */
  item: STACItem;
  /** Render parameters currently chosen in the form. */
  renderParams: TileParams;
  /** Bounding box drawn in the search form, if any. */
  bbox: [number, number, number, number] | null;
}

/** Context passed to custom actions on a row of the Layers view. */
export interface LayerActionContext {
  /** Layer the action was invoked on. */
  layer: ActiveLayer;
}

/**
 * Host-supplied buttons, grouped by the panel view they appear in.
 */
export interface PlanetaryComputerCustomActions {
  /** Buttons under the search form. */
  search?: PlanetaryComputerCustomAction<SearchActionContext>[];
  /** Buttons in the search results toolbar. */
  results?: PlanetaryComputerCustomAction<ResultsActionContext>[];
  /** Buttons in the item detail view. */
  item?: PlanetaryComputerCustomAction<ItemActionContext>[];
  /** Buttons on each row of the Layers view. */
  layer?: PlanetaryComputerCustomAction<LayerActionContext>[];
}

/**
 * Placement and identity options shared by the add-layer methods.
 *
 * Passing `id` (and optionally `sourceId`) re-creates a previously saved layer
 * under its original identifiers, which is how a host restores layers from a
 * saved project.
 */
export interface LayerPlacementOptions {
  /** Layer id to use instead of a generated one. An existing layer with this id is replaced. */
  id?: string;
  /** Source id to use instead of `${id}-source`. */
  sourceId?: string;
  /** Initial visibility. @default true */
  visible?: boolean;
  /** Initial opacity (0-1). @default 1 */
  opacity?: number;
  /** Id of an existing map layer to insert this layer before. */
  beforeId?: string;
}

/**
 * Options for adding a single STAC item as a layer.
 */
export interface AddItemLayerOptions extends LayerPlacementOptions {
  /** Asset names to render. */
  assets?: string[];
  /** Tile rendering parameters. */
  renderParams?: TileParams;
  /** Name of the preset the render parameters came from. */
  presetName?: string;
}

/**
 * Options for adding a mosaic (many items composited into one layer).
 */
export interface AddMosaicLayerOptions extends AddItemLayerOptions {
  /**
   * Search that selects the items to composite: `datetime` range, `query`
   * (for example `{ 'eo:cloud_cover': { lte: 10 } }`), `sortby`, `filter`.
   * `collections` defaults to the collection passed to the method.
   */
  searchParams?: Partial<STACSearchParams>;
  /** Bounds of the layer [west, south, east, north]. Defaults to the collection extent. */
  bbox?: [number, number, number, number];
  /**
   * Search id of a mosaic that is already registered for `searchParams`. When
   * given, registration is skipped and the layer is added synchronously (the
   * returned promise is already settled by the time the call returns).
   */
  mosaicId?: string;
}

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
   * Maximum height of the control panel in pixels.
   * When content exceeds this height, a vertical scrollbar appears.
   * Defaults to the vertical space available in the map container, so the
   * panel grows with its content until it reaches the edge of the map.
   * @default 0 (fill available space)
   */
  maxHeight?: number;

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

  /**
   * STAC client to use instead of one built from `stacApiUrl`. Supply a
   * configured or subclassed {@link STACClient} to add a collection fallback,
   * a custom fetch, or a different search method.
   */
  stacClient?: STACClient;

  /**
   * TiTiler client to use instead of one built from `tilerApiUrl`.
   */
  tilerClient?: TiTilerClient;

  /**
   * Extra buttons supplied by the host application, per panel view.
   */
  customActions?: PlanetaryComputerCustomActions;
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
  /** Search that selects the mosaic's items (for mosaic layers) */
  searchParams?: Partial<STACSearchParams>;
  /** Layer bounds [west, south, east, north], when known */
  bounds?: [number, number, number, number];
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
  /** Whether advanced per-layer controls are expanded */
  showControls?: boolean;
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
  /** Currently highlighted search result item */
  selectedSearchResultId: string | null;
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
