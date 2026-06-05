import type {
  GeoJSONSource,
  IControl,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapMouseEvent,
} from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson';
import type {
  PlanetaryComputerOptions,
  PlanetaryComputerState,
  PlanetaryComputerEvent,
  PlanetaryComputerEventHandler,
  ActiveLayer,
  PanelView,
} from './types';
import type {
  BandStatistics,
  PointValueResponse,
  STACCollection,
  STACItem,
  STACSearchParams,
  TileParams,
} from '../api/types';
import { STACClient } from '../api/stac-client';
import { TiTilerClient } from '../api/titiler-client';
import { SASTokenManager } from '../api/sas-token';
import { LayerManager } from './LayerManager';
import { truncate, formatDate, formatBbox, getItemDate } from '../utils/helpers';
import { getPresetsForCollection } from '../api/render-presets';

/**
 * Default options for the control.
 */
const DEFAULT_OPTIONS: Required<PlanetaryComputerOptions> = {
  collapsed: true,
  position: 'top-right',
  title: 'Planetary Computer',
  panelWidth: 380,
  maxHeight: 500,
  className: '',
  stacApiUrl: 'https://planetarycomputer.microsoft.com/api/stac/v1',
  tilerApiUrl: 'https://planetarycomputer.microsoft.com/api/data/v1',
  defaultCollections: [],
  enableBboxSelector: true,
  maxSearchResults: 50,
  autoLoadCollections: true,
};

const FOOTPRINT_SOURCE_ID = 'pc-search-footprints';
const FOOTPRINT_FILL_LAYER_ID = 'pc-search-footprints-fill';
const FOOTPRINT_OUTLINE_LAYER_ID = 'pc-search-footprints-outline';
const FOOTPRINT_SELECTED_FILL_LAYER_ID = 'pc-search-footprints-selected-fill';
const FOOTPRINT_SELECTED_OUTLINE_LAYER_ID = 'pc-search-footprints-selected-outline';

/**
 * Event handlers map type.
 */
type EventHandlersMap = globalThis.Map<PlanetaryComputerEvent, Set<PlanetaryComputerEventHandler>>;

type ScreenPoint = {
  x: number;
  y: number;
};

type InspectorResult = {
  layerId: string;
  lon: number;
  lat: number;
  loading: boolean;
  data?: PointValueResponse;
  error?: string;
};

type FootprintFeature = Feature<Geometry | Polygon, { itemId: string; title: string }>;

/**
 * MapLibre GL control for browsing and visualizing Planetary Computer data.
 *
 * @example
 * ```typescript
 * const control = new PlanetaryComputerControl({
 *   title: 'Earth Data',
 *   collapsed: false,
 * });
 * map.addControl(control, 'top-right');
 *
 * control.on('layer:add', (event) => {
 *   console.log('Layer added:', event.data);
 * });
 * ```
 */
export class PlanetaryComputerControl implements IControl {
  private _map?: MapLibreMap;
  private _mapContainer?: HTMLElement;
  private _container?: HTMLElement;
  private _panel?: HTMLElement;
  private _contentEl?: HTMLElement;
  private _options: Required<PlanetaryComputerOptions>;
  private _state: PlanetaryComputerState;
  private _eventHandlers: EventHandlersMap = new globalThis.Map();

  // API clients
  private _stacClient: STACClient;
  private _tilerClient: TiTilerClient;
  private _sasManager: SASTokenManager;
  private _layerManager?: LayerManager;

  // Event handlers for cleanup
  private _resizeHandler: (() => void) | null = null;
  private _mapResizeHandler: (() => void) | null = null;
  private _clickOutsideHandler: ((e: MouseEvent) => void) | null = null;
  private _bboxPointerDownHandler: ((e: PointerEvent) => void) | null = null;
  private _bboxPointerMoveHandler: ((e: PointerEvent) => void) | null = null;
  private _bboxPointerUpHandler: ((e: PointerEvent) => void) | null = null;
  private _bboxKeyDownHandler: ((e: KeyboardEvent) => void) | null = null;
  private _bboxOverlay?: HTMLElement;
  private _bboxBox?: HTMLElement;
  private _bboxStartPoint: ScreenPoint | null = null;
  private _bboxDragPanWasEnabled = false;
  private _bboxBoxZoomWasEnabled = false;
  private _ignoreNextDocumentClick = false;
  private _inspectClickHandler: ((e: MapMouseEvent) => void) | null = null;
  private _inspectorLayerId: string | null = null;
  private _inspectorResult: InspectorResult | null = null;
  private _footprintClickHandler: ((e: MapLayerMouseEvent) => void) | null = null;
  private _footprintMouseEnterHandler: (() => void) | null = null;
  private _footprintMouseLeaveHandler: (() => void) | null = null;

  /**
   * Creates a new PlanetaryComputerControl instance.
   *
   * @param options - Configuration options for the control.
   */
  constructor(options?: Partial<PlanetaryComputerOptions>) {
    this._options = { ...DEFAULT_OPTIONS, ...options };
    this._state = this._getInitialState();

    // Initialize API clients
    this._stacClient = new STACClient(this._options.stacApiUrl);
    this._tilerClient = new TiTilerClient(this._options.tilerApiUrl);
    this._sasManager = new SASTokenManager();
  }

  /**
   * Called when the control is added to the map.
   *
   * @param map - The MapLibre GL map instance.
   * @returns The control's container element.
   */
  onAdd(map: MapLibreMap): HTMLElement {
    this._map = map;
    this._mapContainer = map.getContainer();
    this._layerManager = new LayerManager(map, this._tilerClient);

    this._container = this._createContainer();
    this._panel = this._createPanel();
    this._mapContainer.appendChild(this._panel);

    this._setupEventListeners();

    if (!this._state.collapsed) {
      this._panel.classList.add('expanded');
      requestAnimationFrame(() => this._updatePanelPosition());
    }

    // Load collections if auto-load is enabled
    if (this._options.autoLoadCollections) {
      this._loadCollections();
    }

    return this._container;
  }

  /**
   * Called when the control is removed from the map.
   */
  onRemove(): void {
    this._stopBboxDraw(false);
    this._stopInspector(false);
    this._clearSearchFootprints(false);

    // Remove event listeners
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this._mapResizeHandler && this._map) {
      this._map.off('resize', this._mapResizeHandler);
      this._mapResizeHandler = null;
    }
    if (this._clickOutsideHandler) {
      document.removeEventListener('click', this._clickOutsideHandler);
      this._clickOutsideHandler = null;
    }

    // Cleanup API clients
    this._stacClient.cancelPending();
    this._sasManager.clearCache();

    // Remove layers from map
    this._layerManager?.removeAllLayers();

    // Remove DOM elements
    this._panel?.parentNode?.removeChild(this._panel);
    this._container?.parentNode?.removeChild(this._container);

    this._map = undefined;
    this._eventHandlers.clear();
  }

  // ============ Public API Methods ============

  /**
   * Gets the current state of the control.
   *
   * @returns The current plugin state.
   */
  getState(): PlanetaryComputerState {
    return { ...this._state };
  }

  /**
   * Toggles the collapsed state of the control panel.
   */
  toggle(): void {
    if (!this._state.collapsed) {
      this._stopBboxDraw(false);
    }

    this._state.collapsed = !this._state.collapsed;
    this._updatePanelVisibility();
    this._emit(this._state.collapsed ? 'collapse' : 'expand');
    this._emit('statechange');
  }

  /**
   * Expands the control panel.
   */
  expand(): void {
    if (this._state.collapsed) this.toggle();
  }

  /**
   * Collapses the control panel.
   */
  collapse(): void {
    if (!this._state.collapsed) this.toggle();
  }

  /**
   * Loads all available collections.
   *
   * @returns Promise resolving to array of collections.
   */
  async loadCollections(): Promise<STACCollection[]> {
    return this._loadCollections();
  }

  /**
   * Performs a search with the given parameters.
   *
   * @param params - Search parameters.
   * @returns Promise resolving to array of matching items.
   */
  async search(params?: Partial<STACSearchParams>): Promise<STACItem[]> {
    const searchParams: STACSearchParams = {
      ...this._state.searchParams,
      ...params,
      limit: this._options.maxSearchResults,
    };

    this._state.searchParams = searchParams;
    this._state.searchLoading = true;
    this._state.error = null;
    this._emit('search:start');
    this._emit('statechange');
    this._renderContent();

    try {
      const results = await this._stacClient.search(searchParams);
      this._state.searchResults = results;
      this._state.selectedSearchResultId = null;
      this._state.activeView = 'results';
      this._showSearchFootprints(results);
      this._emit('search:complete');
      this._emit('search');
      return results;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Search failed';
      this._state.error = errorMessage;
      this._emit('search:error');
      this._emit('error');
      throw error;
    } finally {
      this._state.searchLoading = false;
      this._emit('statechange');
      this._renderContent();
    }
  }

  /**
   * Adds a STAC item as a raster layer on the map.
   *
   * @param item - STAC item to visualize.
   * @param options - Layer options.
   * @returns The created active layer.
   */
  addItemLayer(
    item: STACItem,
    options?: { assets?: string[]; renderParams?: TileParams; presetName?: string }
  ): ActiveLayer {
    if (!this._layerManager) throw new Error('Control not added to map');

    const layer = this._layerManager.addItemLayer(item, options);
    layer.showControls = false;
    this._state.activeLayers.push(layer);
    this._emit('layer:add');
    this._emit('statechange');
    this._renderContent();
    return layer;
  }

  /**
   * Adds a collection mosaic as a raster layer.
   *
   * @param collection - STAC collection.
   * @param options - Layer options.
   * @returns The created active layer.
   */
  addCollectionLayer(
    collection: STACCollection,
    options?: {
      assets?: string[];
      renderParams?: TileParams;
      bbox?: [number, number, number, number];
      presetName?: string;
    }
  ): ActiveLayer {
    if (!this._layerManager) throw new Error('Control not added to map');

    const layer = this._layerManager.addCollectionLayer(collection, options);
    layer.showControls = false;
    this._state.activeLayers.push(layer);
    this._emit('layer:add');
    this._emit('statechange');
    this._renderContent();
    return layer;
  }

  /**
   * Removes a layer from the map.
   *
   * @param layerId - Layer identifier.
   */
  removeLayer(layerId: string): void {
    if (this._inspectorLayerId === layerId) {
      this._stopInspector(false);
    }
    this._layerManager?.removeLayer(layerId);
    this._state.activeLayers = this._state.activeLayers.filter((l) => l.id !== layerId);
    this._emit('layer:remove');
    this._emit('statechange');
    this._renderContent();
  }

  /**
   * Updates layer properties.
   *
   * @param layerId - Layer identifier.
   * @param updates - Properties to update.
   */
  updateLayer(layerId: string, updates: Partial<ActiveLayer>): void {
    this._layerManager?.updateLayer(layerId, updates);
    const layerIndex = this._state.activeLayers.findIndex((l) => l.id === layerId);
    if (layerIndex >= 0) {
      this._state.activeLayers[layerIndex] = {
        ...this._state.activeLayers[layerIndex],
        ...updates,
      };
    }
    this._emit('layer:update');
    this._emit('statechange');
  }

  /**
   * Zooms the map to a layer's bounds.
   *
   * @param layerId - Layer identifier.
   */
  zoomToLayer(layerId: string): void {
    this._layerManager?.zoomToLayer(layerId);
  }

  /**
   * Gets download URL for an asset with SAS token.
   *
   * @param item - STAC item.
   * @param assetKey - Asset key.
   * @returns Promise resolving to signed download URL.
   */
  async getDownloadUrl(item: STACItem, assetKey: string): Promise<string> {
    const asset = item.assets[assetKey];
    if (!asset) throw new Error(`Asset '${assetKey}' not found`);

    const collectionId = item.collection || '';
    return this._sasManager.signUrl(asset.href, collectionId);
  }

  /**
   * Selects a collection for searching.
   *
   * @param collection - Collection to select.
   */
  selectCollection(collection: STACCollection | null): void {
    this._stopBboxDraw(false);
    this._clearSearchFootprints(false);
    this._state.selectedCollection = collection;
    this._state.searchParams = collection ? { collections: [collection.id] } : {};
    this._state.activeView = collection ? 'search' : 'collections';
    this._state.searchResults = [];
    this._state.selectedItem = null;
    this._state.selectedSearchResultId = null;
    this._emit('collection:select');
    this._emit('statechange');
    this._renderContent();
  }

  /**
   * Selects an item for detail view.
   *
   * @param item - Item to select.
   */
  selectItem(item: STACItem | null): void {
    this._state.selectedItem = item;
    this._state.selectedSearchResultId = item?.id || null;
    this._updateSelectedFootprint();
    this._state.activeView = item ? 'item' : 'results';
    this._emit('item:select');
    this._emit('statechange');
    this._renderContent();
  }

  /**
   * Sets the current view.
   *
   * @param view - View to display.
   */
  setView(view: PanelView): void {
    this._state.activeView = view;
    this._emit('statechange');
    this._renderContent();
  }

  /**
   * Registers an event handler.
   *
   * @param event - Event type.
   * @param handler - Event handler function.
   */
  on(event: PlanetaryComputerEvent, handler: PlanetaryComputerEventHandler): void {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set());
    }
    this._eventHandlers.get(event)!.add(handler);
  }

  /**
   * Removes an event handler.
   *
   * @param event - Event type.
   * @param handler - Event handler function.
   */
  off(event: PlanetaryComputerEvent, handler: PlanetaryComputerEventHandler): void {
    this._eventHandlers.get(event)?.delete(handler);
  }

  /**
   * Gets the map instance.
   *
   * @returns The MapLibre GL map instance.
   */
  getMap(): MapLibreMap | undefined {
    return this._map;
  }

  /**
   * Gets the control container element.
   *
   * @returns The container element.
   */
  getContainer(): HTMLElement | undefined {
    return this._container;
  }

  // ============ Private Methods ============

  /**
   * Gets the initial state.
   */
  private _getInitialState(): PlanetaryComputerState {
    return {
      collapsed: this._options.collapsed,
      panelWidth: this._options.panelWidth,
      activeView: 'collections',
      collections: [],
      collectionsLoading: false,
      selectedCollection: null,
      searchParams: {},
      searchResults: [],
      searchLoading: false,
      selectedItem: null,
      selectedSearchResultId: null,
      activeLayers: [],
      error: null,
      bboxSelectorActive: false,
      drawnBbox: null,
    };
  }

  /**
   * Emits an event.
   */
  private _emit(event: PlanetaryComputerEvent, data?: unknown): void {
    const handlers = this._eventHandlers.get(event);
    if (handlers) {
      const eventData = { type: event, state: this.getState(), data };
      handlers.forEach((handler) => handler(eventData));
    }
  }

  /**
   * Creates the control container.
   */
  private _createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = `maplibregl-ctrl maplibregl-ctrl-group pc-control${
      this._options.className ? ` ${this._options.className}` : ''
    }`;

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'pc-control-toggle';
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-label', this._options.title);
    toggleBtn.innerHTML = `
      <span class="pc-control-icon">
        <svg viewBox="0 0 23 23" width="22" height="22">
          <rect x="1" y="1" width="10" height="10" fill="#666"/>
          <rect x="12" y="1" width="10" height="10" fill="#888"/>
          <rect x="1" y="12" width="10" height="10" fill="#999"/>
          <rect x="12" y="12" width="10" height="10" fill="#777"/>
        </svg>
      </span>
    `;
    toggleBtn.addEventListener('click', () => this.toggle());

    container.appendChild(toggleBtn);
    return container;
  }

  /**
   * Creates the panel element.
   */
  private _createPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'pc-control-panel';
    panel.style.width = `${this._options.panelWidth}px`;
    panel.style.maxHeight = `${this._options.maxHeight}px`;

    // Prevent clicks inside the panel from triggering the click-outside handler
    panel.addEventListener('click', (e) => e.stopPropagation());

    // Header
    const header = document.createElement('div');
    header.className = 'pc-control-header';

    const title = document.createElement('span');
    title.className = 'pc-control-title';
    title.textContent = this._options.title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'pc-control-close';
    closeBtn.type = 'button';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this.collapse());

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Navigation tabs
    const nav = document.createElement('div');
    nav.className = 'pc-control-nav';
    nav.innerHTML = `
      <button type="button" class="pc-nav-btn active" data-view="collections">Collections</button>
      <button type="button" class="pc-nav-btn" data-view="layers">Layers (0)</button>
    `;
    nav.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.dataset.view) {
        this.setView(target.dataset.view as PanelView);
      }
    });

    // Content area
    const content = document.createElement('div');
    content.className = 'pc-control-content';
    this._contentEl = content;

    panel.appendChild(header);
    panel.appendChild(nav);
    panel.appendChild(content);

    return panel;
  }

  /**
   * Renders content based on current view.
   */
  private _renderContent(): void {
    if (!this._contentEl) return;

    // Update nav tabs
    this._updateNavTabs();

    switch (this._state.activeView) {
      case 'collections':
        this._renderCollections();
        break;
      case 'search':
        this._renderSearch();
        break;
      case 'results':
        this._renderResults();
        break;
      case 'item':
        this._renderItem();
        break;
      case 'layers':
        this._renderLayers();
        break;
    }
  }

  /**
   * Updates navigation tabs.
   */
  private _updateNavTabs(): void {
    const nav = this._panel?.querySelector('.pc-control-nav');
    if (!nav) return;

    const layersBtn = nav.querySelector('[data-view="layers"]');
    if (layersBtn) {
      layersBtn.textContent = `Layers (${this._state.activeLayers.length})`;
    }

    nav.querySelectorAll('.pc-nav-btn').forEach((btn) => {
      const view = (btn as HTMLElement).dataset.view;
      btn.classList.toggle('active', view === this._state.activeView ||
        (view === 'collections' && ['collections', 'search', 'results', 'item'].includes(this._state.activeView)));
    });
  }

  /**
   * Renders collections view.
   */
  private _renderCollections(): void {
    if (!this._contentEl) return;

    if (this._state.collectionsLoading) {
      this._contentEl.innerHTML = `
        <div class="pc-loading">
          <div class="pc-spinner"></div>
          <span>Loading collections...</span>
        </div>
      `;
      return;
    }

    if (this._state.error) {
      this._contentEl.innerHTML = `
        <div class="pc-error">
          <span>${this._state.error}</span>
          <button type="button" class="pc-btn pc-btn-small pc-retry">Retry</button>
        </div>
      `;
      this._contentEl.querySelector('.pc-retry')?.addEventListener('click', () => this._loadCollections());
      return;
    }

    this._contentEl.innerHTML = `
      <div class="pc-collection-browser">
        <div class="pc-search-box">
          <input type="text" class="pc-search-input" placeholder="Search ${this._state.collections.length} collections...">
        </div>
        <div class="pc-collection-list"></div>
      </div>
    `;

    const input = this._contentEl.querySelector('.pc-search-input') as HTMLInputElement;
    const listEl = this._contentEl.querySelector('.pc-collection-list') as HTMLElement;

    const renderList = (filter: string = '') => {
      const filtered = this._state.collections.filter((c) => {
        const searchText = filter.toLowerCase();
        return (
          c.id.toLowerCase().includes(searchText) ||
          c.title?.toLowerCase().includes(searchText) ||
          c.description?.toLowerCase().includes(searchText) ||
          c.keywords?.some((k) => k.toLowerCase().includes(searchText))
        );
      });

      listEl.innerHTML = filtered
        .map(
          (c) => `
          <div class="pc-collection-item" data-id="${c.id}">
            <div class="pc-collection-title">${c.title || c.id}</div>
            <div class="pc-collection-description">${truncate(c.description || '', 100)}</div>
            ${
              c.keywords?.length
                ? `<div class="pc-collection-keywords">${c.keywords
                    .slice(0, 3)
                    .map((k) => `<span class="pc-tag">${k}</span>`)
                    .join('')}</div>`
                : ''
            }
          </div>
        `
        )
        .join('');

      listEl.querySelectorAll('.pc-collection-item').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-id');
          const collection = this._state.collections.find((c) => c.id === id);
          if (collection) this.selectCollection(collection);
        });
      });
    };

    renderList();
    input.addEventListener('input', () => renderList(input.value));
  }

  /**
   * Renders search view.
   */
  private _renderSearch(): void {
    if (!this._contentEl || !this._state.selectedCollection) return;

    const collection = this._state.selectedCollection;
    const presets = getPresetsForCollection(collection.id);

    // Check if collection supports cloud cover filtering
    const supportsCloudCover = this._collectionSupportsCloudCover(collection);

    this._contentEl.innerHTML = `
      <div class="pc-search-panel">
        <button type="button" class="pc-btn-back">&larr; Back to collections</button>

        <div class="pc-selected-collection">
          <span class="pc-label">Collection</span>
          <span class="pc-collection-name">${collection.title || collection.id}</span>
          <button type="button" class="pc-btn pc-btn-small pc-open-collection-page">Open Webpage</button>
        </div>

        <div class="pc-form-group">
          <label class="pc-label">Bounding Box</label>
          <div class="pc-bbox-display">
            <div class="pc-bbox-actions">
              ${
                this._options.enableBboxSelector
                  ? `<button type="button" class="pc-btn pc-btn-small pc-draw-bbox${
                      this._state.bboxSelectorActive ? ' pc-btn-active' : ''
                    }">${this._state.bboxSelectorActive ? 'Cancel Draw' : 'Draw Bbox'}</button>`
                  : ''
              }
              <button type="button" class="pc-btn pc-btn-small pc-use-view">Use Map View</button>
              <button type="button" class="pc-btn pc-btn-small pc-clear-bbox" ${
                this._state.drawnBbox ? '' : 'disabled'
              }>Clear</button>
            </div>
            <div class="pc-bbox-coordinates">
              <span class="pc-bbox-text">${
                this._state.bboxSelectorActive
                  ? 'Drag on the map to draw a bounding box'
                  : this._state.drawnBbox
                    ? formatBbox(this._state.drawnBbox)
                    : 'Use current map view'
              }</span>
            </div>
          </div>
        </div>

        <div class="pc-form-group">
          <label class="pc-label">Date Range</label>
          <div class="pc-date-inputs">
            <input type="date" class="pc-input pc-date-start">
            <span class="pc-date-separator">to</span>
            <input type="date" class="pc-input pc-date-end">
          </div>
        </div>

        ${supportsCloudCover ? `
        <div class="pc-form-group">
          <label class="pc-label">Max Cloud Cover (%)</label>
          <div class="pc-cloud-cover-input">
            <input type="range" class="pc-cloud-slider" min="0" max="100" value="100">
            <span class="pc-cloud-value">100%</span>
          </div>
        </div>
        ` : ''}

        <div class="pc-form-group">
          <label class="pc-label">Results Limit</label>
          <select class="pc-input pc-limit-select">
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50" selected>50</option>
            <option value="100">100</option>
          </select>
        </div>

        <div class="pc-form-group">
          <label class="pc-label">Sort By</label>
          <select class="pc-input pc-sort-select">
            <option value="datetime-desc">Date (Newest First)</option>
            <option value="datetime-asc">Date (Oldest First)</option>
            ${supportsCloudCover ? `
            <option value="cloud-asc">Cloud Cover (Lowest First)</option>
            <option value="cloud-desc">Cloud Cover (Highest First)</option>
            ` : ''}
          </select>
        </div>

        ${
          presets.length
            ? `
          <div class="pc-form-group">
            <label class="pc-label">Visualization Preset</label>
            <select class="pc-input pc-preset-select">
              ${presets.map((p) => `<option value="${p.name}">${p.label}</option>`).join('')}
            </select>
          </div>
        `
            : ''
        }

        <button type="button" class="pc-btn pc-btn-primary pc-search-btn${
          this._state.searchLoading ? ' pc-search-btn-loading' : ''
        }" ${this._state.searchLoading ? 'disabled aria-busy="true"' : ''}>
          ${this._state.searchLoading ? '<span class="pc-search-spinner"></span>Searching...' : 'Search Items'}
        </button>
      </div>
    `;

    // Event handlers
    this._contentEl.querySelector('.pc-btn-back')?.addEventListener('click', () => {
      this.selectCollection(null);
    });

    this._contentEl.querySelector('.pc-open-collection-page')?.addEventListener('click', () => {
      window.open(this._getCollectionPageUrl(collection), '_blank');
    });

    this._contentEl.querySelector('.pc-use-view')?.addEventListener('click', () => {
      if (this._map) {
        this._stopBboxDraw(false);
        const bounds = this._map.getBounds();
        this._state.drawnBbox = [
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        ];
        this._state.searchParams.bbox = this._state.drawnBbox;
        this._renderContent();
      }
    });

    this._contentEl.querySelector('.pc-clear-bbox')?.addEventListener('click', () => {
      this._stopBboxDraw(false);
      this._state.drawnBbox = null;
      delete this._state.searchParams.bbox;
      this._emit('statechange');
      this._renderContent();
    });

    this._contentEl.querySelector('.pc-draw-bbox')?.addEventListener('click', () => {
      if (this._state.bboxSelectorActive) {
        this._stopBboxDraw();
      } else {
        this._startBboxDraw();
      }
    });

    // Cloud cover slider
    const cloudSlider = this._contentEl.querySelector('.pc-cloud-slider') as HTMLInputElement;
    const cloudValue = this._contentEl.querySelector('.pc-cloud-value');
    if (cloudSlider && cloudValue) {
      cloudSlider.addEventListener('input', () => {
        cloudValue.textContent = `${cloudSlider.value}%`;
      });
    }

    this._contentEl.querySelector('.pc-search-btn')?.addEventListener('click', () => {
      if (this._state.searchLoading) return;

      const startDate = (this._contentEl?.querySelector('.pc-date-start') as HTMLInputElement)?.value;
      const endDate = (this._contentEl?.querySelector('.pc-date-end') as HTMLInputElement)?.value;
      const cloudCover = (this._contentEl?.querySelector('.pc-cloud-slider') as HTMLInputElement)?.value;
      const limit = (this._contentEl?.querySelector('.pc-limit-select') as HTMLSelectElement)?.value;
      const sortBy = (this._contentEl?.querySelector('.pc-sort-select') as HTMLSelectElement)?.value;

      if (startDate || endDate) {
        const start = startDate ? `${startDate}T00:00:00Z` : '..';
        const end = endDate ? `${endDate}T23:59:59Z` : '..';
        this._state.searchParams.datetime = `${start}/${end}`;
      }

      if (!this._state.searchParams.bbox && this._map) {
        const bounds = this._map.getBounds();
        this._state.searchParams.bbox = [
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        ];
      }

      // Apply cloud cover filter if set and less than 100%
      if (cloudCover && parseInt(cloudCover) < 100) {
        this._state.searchParams.query = {
          'eo:cloud_cover': { lte: parseInt(cloudCover) },
        };
      }

      // Apply limit
      if (limit) {
        this._state.searchParams.limit = parseInt(limit);
      }

      // Apply sort
      if (sortBy) {
        const [field, direction] = sortBy.split('-');
        const sortField = field === 'cloud' ? 'properties.eo:cloud_cover' : 'properties.datetime';
        this._state.searchParams.sortby = [{ field: sortField, direction: direction as 'asc' | 'desc' }];
      }

      this.search();
    });
  }

  /**
   * Checks if a collection supports cloud cover filtering.
   */
  private _collectionSupportsCloudCover(collection: STACCollection): boolean {
    // Collections that typically have cloud cover metadata
    const cloudCoverCollections = [
      'sentinel-2-l2a',
      'sentinel-2-l1c',
      'landsat-c2-l1',
      'landsat-c2-l2',
      'landsat-8-c2-l2',
      'landsat-9-c2-l2',
      'modis-09A1-061',
      'modis-09Q1-061',
    ];

    // Check if collection ID matches or if summaries include eo:cloud_cover
    if (cloudCoverCollections.some(id => collection.id.includes(id))) {
      return true;
    }

    // Check summaries
    if (collection.summaries?.['eo:cloud_cover']) {
      return true;
    }

    return false;
  }

  /**
   * Gets the public Planetary Computer webpage URL for a collection.
   */
  private _getCollectionPageUrl(collection: STACCollection): string {
    return `https://planetarycomputer.microsoft.com/dataset/${encodeURIComponent(collection.id)}`;
  }

  /**
   * Starts interactive map bounding box drawing.
   */
  private _startBboxDraw(): void {
    if (!this._map || !this._mapContainer || !this._options.enableBboxSelector) return;

    this._stopBboxDraw(false);
    this._state.bboxSelectorActive = true;
    this._bboxStartPoint = null;
    this._bboxDragPanWasEnabled = this._map.dragPan.isEnabled();
    this._bboxBoxZoomWasEnabled = this._map.boxZoom.isEnabled();
    this._map.dragPan.disable();
    this._map.boxZoom.disable();

    this._mapContainer.classList.add('pc-bbox-drawing');

    this._bboxOverlay = document.createElement('div');
    this._bboxOverlay.className = 'pc-bbox-overlay';
    this._bboxOverlay.innerHTML = '<div class="pc-bbox-instructions">Drag on the map to draw a bounding box</div>';

    this._bboxBox = document.createElement('div');
    this._bboxBox.className = 'pc-bbox-box';
    this._bboxOverlay.appendChild(this._bboxBox);
    this._mapContainer.appendChild(this._bboxOverlay);

    this._bboxPointerDownHandler = (event: PointerEvent) => {
      if (event.button !== 0 || !this._mapContainer) return;

      event.preventDefault();
      event.stopPropagation();
      this._ignoreNextDocumentClick = true;
      this._bboxStartPoint = this._getPointerPoint(event);
      this._updateBboxBox(this._bboxStartPoint, this._bboxStartPoint);
    };

    this._bboxPointerMoveHandler = (event: PointerEvent) => {
      if (!this._bboxStartPoint) return;

      event.preventDefault();
      this._updateBboxBox(this._bboxStartPoint, this._getPointerPoint(event));
    };

    this._bboxPointerUpHandler = (event: PointerEvent) => {
      if (!this._bboxStartPoint || !this._map) return;

      event.preventDefault();
      this._ignoreNextDocumentClick = true;

      const endPoint = this._getPointerPoint(event);
      const left = Math.min(this._bboxStartPoint.x, endPoint.x);
      const right = Math.max(this._bboxStartPoint.x, endPoint.x);
      const top = Math.min(this._bboxStartPoint.y, endPoint.y);
      const bottom = Math.max(this._bboxStartPoint.y, endPoint.y);

      if (right - left < 4 || bottom - top < 4) {
        this._bboxStartPoint = null;
        if (this._bboxBox) {
          this._bboxBox.style.display = 'none';
        }
        return;
      }

      const southwest = this._map.unproject([left, bottom]);
      const northeast = this._map.unproject([right, top]);
      const bbox: [number, number, number, number] = [
        Math.min(southwest.lng, northeast.lng),
        Math.min(southwest.lat, northeast.lat),
        Math.max(southwest.lng, northeast.lng),
        Math.max(southwest.lat, northeast.lat),
      ];

      this._state.drawnBbox = bbox;
      this._state.searchParams.bbox = bbox;
      this._stopBboxDraw(false);
      this._emit('bbox:complete', bbox);
      this._emit('statechange');
      this._renderContent();
    };

    this._bboxKeyDownHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this._stopBboxDraw();
      }
    };

    this._mapContainer.addEventListener('pointerdown', this._bboxPointerDownHandler);
    window.addEventListener('pointermove', this._bboxPointerMoveHandler);
    window.addEventListener('pointerup', this._bboxPointerUpHandler);
    document.addEventListener('keydown', this._bboxKeyDownHandler);

    this._emit('bbox:start');
    this._emit('statechange');
    this._renderContent();
  }

  /**
   * Stops interactive bounding box drawing and restores map input.
   */
  private _stopBboxDraw(render = true): void {
    if (this._bboxPointerDownHandler && this._mapContainer) {
      this._mapContainer.removeEventListener('pointerdown', this._bboxPointerDownHandler);
    }
    if (this._bboxPointerMoveHandler) {
      window.removeEventListener('pointermove', this._bboxPointerMoveHandler);
    }
    if (this._bboxPointerUpHandler) {
      window.removeEventListener('pointerup', this._bboxPointerUpHandler);
    }
    if (this._bboxKeyDownHandler) {
      document.removeEventListener('keydown', this._bboxKeyDownHandler);
    }

    this._bboxPointerDownHandler = null;
    this._bboxPointerMoveHandler = null;
    this._bboxPointerUpHandler = null;
    this._bboxKeyDownHandler = null;
    this._bboxStartPoint = null;

    this._bboxOverlay?.parentNode?.removeChild(this._bboxOverlay);
    this._bboxOverlay = undefined;
    this._bboxBox = undefined;

    this._mapContainer?.classList.remove('pc-bbox-drawing');

    if (this._map) {
      if (this._bboxDragPanWasEnabled && !this._map.dragPan.isEnabled()) {
        this._map.dragPan.enable();
      }
      if (this._bboxBoxZoomWasEnabled && !this._map.boxZoom.isEnabled()) {
        this._map.boxZoom.enable();
      }
    }

    if (!this._state.bboxSelectorActive) return;

    this._state.bboxSelectorActive = false;
    this._emit('statechange');
    if (render) {
      this._renderContent();
    }
  }

  /**
   * Gets a pointer location relative to the map container.
   */
  private _getPointerPoint(event: PointerEvent): ScreenPoint {
    const rect = this._mapContainer?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  /**
   * Updates the visible bounding box rectangle.
   */
  private _updateBboxBox(startPoint: ScreenPoint, endPoint: ScreenPoint): void {
    if (!this._bboxBox) return;

    const left = Math.min(startPoint.x, endPoint.x);
    const top = Math.min(startPoint.y, endPoint.y);
    const width = Math.abs(startPoint.x - endPoint.x);
    const height = Math.abs(startPoint.y - endPoint.y);

    this._bboxBox.style.display = 'block';
    this._bboxBox.style.left = `${left}px`;
    this._bboxBox.style.top = `${top}px`;
    this._bboxBox.style.width = `${width}px`;
    this._bboxBox.style.height = `${height}px`;
  }

  /**
   * Shows search result footprints on the map.
   */
  private _showSearchFootprints(items: STACItem[]): void {
    if (!this._map) return;

    if (!this._map.isStyleLoaded()) {
      this._map.once('load', () => this._showSearchFootprints(items));
      return;
    }

    const data: FeatureCollection<Geometry | Polygon, FootprintFeature['properties']> = {
      type: 'FeatureCollection',
      features: items
        .map((item) => this._itemToFootprintFeature(item))
        .filter((feature): feature is FootprintFeature => Boolean(feature)),
    };

    const source = this._map.getSource(FOOTPRINT_SOURCE_ID) as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      this._map.addSource(FOOTPRINT_SOURCE_ID, {
        type: 'geojson',
        data,
      });
    }

    this._ensureFootprintLayers();
    this._bindFootprintInteractions();
    this._updateSelectedFootprint();
  }

  /**
   * Adds footprint layers if they do not already exist.
   */
  private _ensureFootprintLayers(): void {
    if (!this._map) return;

    if (!this._map.getLayer(FOOTPRINT_FILL_LAYER_ID)) {
      this._map.addLayer({
        id: FOOTPRINT_FILL_LAYER_ID,
        type: 'fill',
        source: FOOTPRINT_SOURCE_ID,
        paint: {
          'fill-color': '#0078d4',
          'fill-opacity': 0.1,
        },
      });
    }

    if (!this._map.getLayer(FOOTPRINT_OUTLINE_LAYER_ID)) {
      this._map.addLayer({
        id: FOOTPRINT_OUTLINE_LAYER_ID,
        type: 'line',
        source: FOOTPRINT_SOURCE_ID,
        paint: {
          'line-color': '#0078d4',
          'line-width': 1.5,
          'line-opacity': 0.75,
        },
      });
    }

    if (!this._map.getLayer(FOOTPRINT_SELECTED_FILL_LAYER_ID)) {
      this._map.addLayer({
        id: FOOTPRINT_SELECTED_FILL_LAYER_ID,
        type: 'fill',
        source: FOOTPRINT_SOURCE_ID,
        filter: ['==', ['get', 'itemId'], ''],
        paint: {
          'fill-color': '#ffb900',
          'fill-opacity': 0.24,
        },
      });
    }

    if (!this._map.getLayer(FOOTPRINT_SELECTED_OUTLINE_LAYER_ID)) {
      this._map.addLayer({
        id: FOOTPRINT_SELECTED_OUTLINE_LAYER_ID,
        type: 'line',
        source: FOOTPRINT_SOURCE_ID,
        filter: ['==', ['get', 'itemId'], ''],
        paint: {
          'line-color': '#ff8c00',
          'line-width': 3,
          'line-opacity': 0.95,
        },
      });
    }
  }

  /**
   * Binds map interactions for selecting footprint features.
   */
  private _bindFootprintInteractions(): void {
    if (!this._map || this._footprintClickHandler) return;

    this._footprintClickHandler = (event: MapLayerMouseEvent) => {
      if (this._state.bboxSelectorActive || this._inspectorLayerId) return;

      const itemId = event.features?.[0]?.properties?.itemId;
      if (typeof itemId !== 'string') return;

      this._ignoreNextDocumentClick = true;
      this._selectSearchResult(itemId, { fromMap: true });
    };

    this._footprintMouseEnterHandler = () => {
      if (this._mapContainer && !this._state.bboxSelectorActive && !this._inspectorLayerId) {
        this._mapContainer.style.cursor = 'pointer';
      }
    };

    this._footprintMouseLeaveHandler = () => {
      if (this._mapContainer && !this._state.bboxSelectorActive && !this._inspectorLayerId) {
        this._mapContainer.style.cursor = '';
      }
    };

    this._map.on('click', FOOTPRINT_FILL_LAYER_ID, this._footprintClickHandler);
    this._map.on('mouseenter', FOOTPRINT_FILL_LAYER_ID, this._footprintMouseEnterHandler);
    this._map.on('mouseleave', FOOTPRINT_FILL_LAYER_ID, this._footprintMouseLeaveHandler);
  }

  /**
   * Selects a search result and highlights its footprint.
   */
  private _selectSearchResult(itemId: string | null, options: { fromMap?: boolean } = {}): void {
    this._state.selectedSearchResultId = itemId;
    this._state.selectedItem = itemId
      ? this._state.searchResults.find((item) => item.id === itemId) || null
      : null;
    this._updateSelectedFootprint();
    if (options.fromMap && this._state.activeView !== 'results') {
      this._state.activeView = 'results';
    }

    this._emit('item:select');
    this._emit('statechange');
    this._renderContent();

    if (options.fromMap) {
      this._scrollSelectedResultIntoView();
    }
  }

  /**
   * Clears only the current search result selection.
   */
  private _clearSearchSelection(render = true): void {
    this._state.selectedSearchResultId = null;
    this._state.selectedItem = null;
    this._updateSelectedFootprint();
    this._emit('statechange');

    if (render) {
      this._renderContent();
    }
  }

  /**
   * Removes all search footprint overlays from the map.
   */
  private _clearSearchFootprints(render = true): void {
    if (this._map) {
      if (this._footprintClickHandler) {
        this._map.off('click', FOOTPRINT_FILL_LAYER_ID, this._footprintClickHandler);
      }
      if (this._footprintMouseEnterHandler) {
        this._map.off('mouseenter', FOOTPRINT_FILL_LAYER_ID, this._footprintMouseEnterHandler);
      }
      if (this._footprintMouseLeaveHandler) {
        this._map.off('mouseleave', FOOTPRINT_FILL_LAYER_ID, this._footprintMouseLeaveHandler);
      }

      [
        FOOTPRINT_SELECTED_OUTLINE_LAYER_ID,
        FOOTPRINT_SELECTED_FILL_LAYER_ID,
        FOOTPRINT_OUTLINE_LAYER_ID,
        FOOTPRINT_FILL_LAYER_ID,
      ].forEach((layerId) => {
        if (this._map?.getLayer(layerId)) {
          this._map.removeLayer(layerId);
        }
      });

      if (this._map.getSource(FOOTPRINT_SOURCE_ID)) {
        this._map.removeSource(FOOTPRINT_SOURCE_ID);
      }
    }

    this._footprintClickHandler = null;
    this._footprintMouseEnterHandler = null;
    this._footprintMouseLeaveHandler = null;
    this._mapContainer?.style.removeProperty('cursor');
    this._state.selectedSearchResultId = null;
    this._state.selectedItem = null;

    if (render) {
      this._emit('statechange');
      this._renderContent();
    }
  }

  /**
   * Updates the highlighted footprint filter.
   */
  private _updateSelectedFootprint(): void {
    if (!this._map) return;

    const itemId = this._state.selectedSearchResultId || '';
    const filter: ['==', ['get', string], string] = ['==', ['get', 'itemId'], itemId];

    if (this._map.getLayer(FOOTPRINT_SELECTED_FILL_LAYER_ID)) {
      this._map.setFilter(FOOTPRINT_SELECTED_FILL_LAYER_ID, filter);
    }
    if (this._map.getLayer(FOOTPRINT_SELECTED_OUTLINE_LAYER_ID)) {
      this._map.setFilter(FOOTPRINT_SELECTED_OUTLINE_LAYER_ID, filter);
    }
  }

  /**
   * Converts a STAC item to a footprint feature.
   */
  private _itemToFootprintFeature(item: STACItem): FootprintFeature | null {
    const geometry = item.geometry || this._bboxToPolygon(item.bbox);
    if (!geometry) return null;

    return {
      type: 'Feature',
      id: item.id,
      geometry,
      properties: {
        itemId: item.id,
        title: item.id,
      },
    };
  }

  /**
   * Converts a bbox to a polygon geometry.
   */
  private _bboxToPolygon(bbox?: number[]): Polygon | null {
    if (!bbox || bbox.length < 4) return null;

    const [west, south, east, north] = bbox;
    if (![west, south, east, north].every((value) => Number.isFinite(value))) {
      return null;
    }

    return {
      type: 'Polygon',
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    };
  }

  /**
   * Scrolls the selected result row into view.
   */
  private _scrollSelectedResultIntoView(): void {
    if (!this._state.selectedSearchResultId) return;

    const selectedEl = Array.from(this._contentEl?.querySelectorAll('.pc-result-item') || []).find(
      (el) => el.getAttribute('data-id') === this._state.selectedSearchResultId
    );
    selectedEl?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Renders results view.
   */
  private _renderResults(): void {
    if (!this._contentEl) return;

    if (this._state.searchLoading) {
      this._contentEl.innerHTML = `
        <div class="pc-loading">
          <div class="pc-spinner"></div>
          <span>Searching...</span>
        </div>
      `;
      return;
    }

    const results = this._state.searchResults;
    const selectedId = this._state.selectedSearchResultId;

    this._contentEl.innerHTML = `
      <div class="pc-results">
        <div class="pc-results-header">
          <button type="button" class="pc-btn-back">&larr; Back</button>
          <span class="pc-results-count">${results.length} items found</span>
        </div>
        ${
          results.length
            ? `
        <div class="pc-results-toolbar">
          <button type="button" class="pc-btn pc-btn-small pc-clear-result-selection" ${selectedId ? '' : 'disabled'}>
            Clear Selection
          </button>
          <button type="button" class="pc-btn pc-btn-small pc-clear-footprints">
            Clear Footprints
          </button>
        </div>
        `
            : ''
        }
        <div class="pc-results-list">
          ${
            results.length === 0
              ? '<div class="pc-results-empty">No items found. Try adjusting your search.</div>'
              : results
                  .map(
                    (item) => `
                <div class="pc-result-item${
                  selectedId === item.id ? ' pc-result-selected' : ''
                }" data-id="${item.id}">
                  ${
                    item.assets.thumbnail?.href
                      ? `<div class="pc-result-thumbnail"><img src="${item.assets.thumbnail.href}" alt="" loading="lazy"></div>`
                      : ''
                  }
                  <div class="pc-result-info">
                    <div class="pc-result-title">${item.id}</div>
                    <div class="pc-result-date">${formatDate(getItemDate(item.properties))}</div>
                    ${
                      item.properties['eo:cloud_cover'] !== undefined
                        ? `<div class="pc-result-cloud">Cloud: ${item.properties['eo:cloud_cover'].toFixed(0)}%</div>`
                        : ''
                    }
                  </div>
                  <div class="pc-result-actions">
                    <button type="button" class="pc-btn pc-btn-small pc-view-item" title="View details">View</button>
                    <button type="button" class="pc-btn pc-btn-small pc-add-layer" title="Add to map">+</button>
                  </div>
                </div>
              `
                  )
                  .join('')
          }
        </div>
      </div>
    `;

    this._contentEl.querySelector('.pc-btn-back')?.addEventListener('click', () => {
      this.setView('search');
    });

    this._contentEl.querySelector('.pc-clear-result-selection')?.addEventListener('click', () => {
      this._clearSearchSelection();
    });

    this._contentEl.querySelector('.pc-clear-footprints')?.addEventListener('click', () => {
      this._clearSearchFootprints();
    });

    this._contentEl.querySelectorAll('.pc-result-item').forEach((el) => {
      const id = el.getAttribute('data-id');
      const item = results.find((i) => i.id === id);
      if (!item) return;

      el.querySelector('.pc-add-layer')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const layer = this.addItemLayer(item);
        if (layer) {
          this.zoomToLayer(layer.id);
        }
      });

      el.querySelector('.pc-view-item')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectItem(item);
      });

      el.addEventListener('click', () => {
        this.selectItem(item);
      });
    });
  }

  /**
   * Renders item detail view.
   */
  private _renderItem(): void {
    if (!this._contentEl || !this._state.selectedItem) return;

    const item = this._state.selectedItem;
    const assets = Object.entries(item.assets);
    const presets = item.collection ? getPresetsForCollection(item.collection) : [];

    // Filter assets that can be visualized (COG, GeoTIFF, image types)
    const visualizableAssets = assets.filter(([, asset]) => {
      const type = asset.type || '';
      return type.includes('tiff') || type.includes('geotiff') || type.includes('cog') ||
             type.includes('image') || !type; // Include if no type specified
    });

    // Common colormaps available in TiTiler
    const colormaps = [
      { name: '', label: 'None (Default)' },
      { name: 'viridis', label: 'Viridis' },
      { name: 'plasma', label: 'Plasma' },
      { name: 'inferno', label: 'Inferno' },
      { name: 'magma', label: 'Magma' },
      { name: 'cividis', label: 'Cividis' },
      { name: 'terrain', label: 'Terrain' },
      { name: 'rdylgn', label: 'Red-Yellow-Green' },
      { name: 'rdylbu', label: 'Red-Yellow-Blue' },
      { name: 'spectral', label: 'Spectral' },
      { name: 'coolwarm', label: 'Cool-Warm' },
      { name: 'blues', label: 'Blues' },
      { name: 'greens', label: 'Greens' },
      { name: 'reds', label: 'Reds' },
      { name: 'greys', label: 'Greys' },
      { name: 'ylgnbu', label: 'Yellow-Green-Blue' },
      { name: 'rainbow', label: 'Rainbow' },
    ];

    this._contentEl.innerHTML = `
      <div class="pc-item-details">
        <div class="pc-details-header">
          <button type="button" class="pc-btn-back">&larr; Back</button>
          <h3 class="pc-details-title">${item.id}</h3>
        </div>

        <div class="pc-details-meta">
          <div class="pc-meta-item">
            <span class="pc-label">Date</span>
            <span class="pc-value">${formatDate(getItemDate(item.properties))}</span>
          </div>
          ${
            item.properties['eo:cloud_cover'] !== undefined
              ? `
            <div class="pc-meta-item">
              <span class="pc-label">Cloud Cover</span>
              <span class="pc-value">${(item.properties['eo:cloud_cover'] as number).toFixed(1)}%</span>
            </div>
          `
              : ''
          }
        </div>

        <div class="pc-details-section">
          <h4 class="pc-section-title">Visualization Options</h4>

          ${
            presets.length
              ? `
            <div class="pc-form-group">
              <label class="pc-label">Preset</label>
              <select class="pc-input pc-preset-select">
                <option value="">Custom</option>
                ${presets.map((p) => `<option value="${p.name}">${p.label}</option>`).join('')}
              </select>
            </div>
          `
              : ''
          }

          <div class="pc-custom-viz">
            <div class="pc-form-group">
              <label class="pc-label">Asset</label>
              <select class="pc-input pc-asset-select">
                ${visualizableAssets.map(([key, asset]) =>
                  `<option value="${key}">${asset.title || key}</option>`
                ).join('')}
              </select>
            </div>

            <div class="pc-form-group">
              <label class="pc-label">Rescale (Min, Max)</label>
              <div class="pc-rescale-inputs">
                <input type="number" class="pc-input pc-rescale-min" placeholder="Min (e.g., 0)" step="any">
                <span class="pc-rescale-separator">to</span>
                <input type="number" class="pc-input pc-rescale-max" placeholder="Max (e.g., 255)" step="any">
              </div>
            </div>

            <div class="pc-form-group">
              <label class="pc-label">Colormap</label>
              <select class="pc-input pc-colormap-select">
                ${colormaps.map((c) => `<option value="${c.name}">${c.label}</option>`).join('')}
              </select>
            </div>

            <div class="pc-form-group">
              <label class="pc-label">Band Expression (optional)</label>
              <input type="text" class="pc-input pc-expression-input" placeholder="e.g., (B08-B04)/(B08+B04)">
              <small class="pc-hint">Leave empty to use selected asset. Use band math for indices like NDVI.</small>
            </div>

            <details class="pc-advanced-render">
              <summary>Advanced Rendering</summary>

              <div class="pc-form-group">
                <label class="pc-label">Tile Output</label>
                <div class="pc-advanced-grid">
                  <select class="pc-input pc-tile-format">
                    <option value="">Default</option>
                    <option value="png">PNG</option>
                    <option value="jpg">JPG</option>
                    <option value="webp">WebP</option>
                    <option value="pngraw">PNG Raw</option>
                  </select>
                  <select class="pc-input pc-tile-scale">
                    <option value="">1x</option>
                    <option value="2">2x</option>
                    <option value="3">3x</option>
                    <option value="4">4x</option>
                  </select>
                </div>
              </div>

              <div class="pc-form-group">
                <label class="pc-label">Zoom Range</label>
                <div class="pc-rescale-inputs">
                  <input type="number" class="pc-input pc-minzoom" placeholder="Min zoom" min="0" max="30">
                  <span class="pc-rescale-separator">to</span>
                  <input type="number" class="pc-input pc-maxzoom" placeholder="Max zoom" min="0" max="30">
                </div>
              </div>

              <div class="pc-form-group">
                <label class="pc-label">Color Formula</label>
                <input type="text" class="pc-input pc-color-formula" placeholder="e.g., gamma rgb 1.8">
              </div>

              <div class="pc-advanced-grid">
                <div class="pc-form-group">
                  <label class="pc-label">Nodata</label>
                  <input type="number" class="pc-input pc-nodata" placeholder="Auto" step="any">
                </div>
                <div class="pc-form-group">
                  <label class="pc-label">Buffer</label>
                  <input type="number" class="pc-input pc-buffer" placeholder="0" min="0" step="1">
                </div>
              </div>

              <div class="pc-checkbox-group">
                <label><input type="checkbox" class="pc-unscale"> Unscale</label>
                <label><input type="checkbox" class="pc-asset-as-band"> Asset as band</label>
                <label><input type="checkbox" class="pc-return-mask"> Return mask</label>
              </div>
            </details>
          </div>
        </div>

        <div class="pc-details-section">
          <h4 class="pc-section-title">Data API Tools</h4>
          <div class="pc-tool-actions">
            <button type="button" class="pc-btn pc-btn-small pc-load-stats">Statistics</button>
            <button type="button" class="pc-btn pc-btn-small pc-auto-stretch">Auto Stretch</button>
            <button type="button" class="pc-btn pc-btn-small pc-show-legend">Legend</button>
            <button type="button" class="pc-btn pc-btn-small pc-load-tilejson">TileJSON</button>
            <button type="button" class="pc-btn pc-btn-small pc-export-preview">Preview</button>
            <button type="button" class="pc-btn pc-btn-small pc-export-bbox" ${
              this._state.drawnBbox ? '' : 'disabled'
            }>BBox Image</button>
          </div>
          <div class="pc-tool-output pc-stats-output"></div>
        </div>

        <div class="pc-details-section">
          <h4 class="pc-section-title">Assets (${assets.length})</h4>
          <div class="pc-assets-list">
            ${assets
              .map(
                ([key, asset]) => `
              <div class="pc-asset-item" data-key="${key}">
                <div class="pc-asset-info">
                  <div class="pc-asset-name">${asset.title || key}</div>
                  <div class="pc-asset-type">${asset.type || 'Unknown'}</div>
                </div>
                <button type="button" class="pc-btn pc-btn-small pc-download-asset">Download</button>
              </div>
            `
              )
              .join('')}
          </div>
        </div>

        <div class="pc-details-actions">
          <button type="button" class="pc-btn pc-btn-primary pc-add-to-map">Add to Map</button>
        </div>
      </div>
    `;

    // Toggle custom visualization options based on preset selection
    const presetSelect = this._contentEl.querySelector('.pc-preset-select') as HTMLSelectElement;
    const customViz = this._contentEl.querySelector('.pc-custom-viz') as HTMLElement;
    if (presetSelect && customViz) {
      presetSelect.addEventListener('change', () => {
        customViz.style.display = presetSelect.value ? 'none' : 'block';
      });
    }

    this._contentEl.querySelector('.pc-btn-back')?.addEventListener('click', () => {
      this._state.activeView = 'results';
      this._emit('statechange');
      this._renderContent();
    });

    const getCurrentRenderParams = (): TileParams => {
      const presetName = (this._contentEl?.querySelector('.pc-preset-select') as HTMLSelectElement)?.value;
      const advancedParams = this._getAdvancedRenderParams();
      if (presetName) {
        return { ...(presets.find((p) => p.name === presetName)?.params || {}), ...advancedParams };
      }

      return { ...this._getCustomRenderParams(), ...advancedParams };
    };

    this._contentEl.querySelector('.pc-load-stats')?.addEventListener('click', async () => {
      await this._loadItemStatistics(item, getCurrentRenderParams());
    });

    this._contentEl.querySelector('.pc-auto-stretch')?.addEventListener('click', async () => {
      await this._autoStretchItem(item, getCurrentRenderParams());
    });

    this._contentEl.querySelector('.pc-show-legend')?.addEventListener('click', () => {
      this._showRenderLegend(getCurrentRenderParams());
    });

    this._contentEl.querySelector('.pc-load-tilejson')?.addEventListener('click', async () => {
      await this._loadItemTileJSON(item, getCurrentRenderParams());
    });

    this._contentEl.querySelector('.pc-export-preview')?.addEventListener('click', () => {
      this._openItemPreview(item, getCurrentRenderParams());
    });

    this._contentEl.querySelector('.pc-export-bbox')?.addEventListener('click', () => {
      this._openItemBboxImage(item, getCurrentRenderParams());
    });

    this._contentEl.querySelector('.pc-add-to-map')?.addEventListener('click', () => {
      const presetName = (this._contentEl?.querySelector('.pc-preset-select') as HTMLSelectElement)?.value;
      let layer;

      if (presetName) {
        // Use preset
        const preset = presets.find((p) => p.name === presetName);
        layer = this.addItemLayer(item, preset ? { presetName, renderParams: getCurrentRenderParams() } : undefined);
      } else {
        layer = this.addItemLayer(item, { renderParams: getCurrentRenderParams() });
      }

      // Zoom to the added layer
      if (layer) {
        this.zoomToLayer(layer.id);
      }
    });

    this._contentEl.querySelectorAll('.pc-download-asset').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const assetKey = (btn.closest('.pc-asset-item') as HTMLElement)?.dataset.key;
        if (assetKey) {
          try {
            const url = await this.getDownloadUrl(item, assetKey);
            window.open(url, '_blank');
          } catch (error) {
            console.error('Download error:', error);
          }
        }
      });
    });
  }

  /**
   * Gets custom render parameters from the item detail form.
   */
  private _getCustomRenderParams(): TileParams {
    const assetSelect = this._contentEl?.querySelector('.pc-asset-select') as HTMLSelectElement;
    const rescaleMin = (this._contentEl?.querySelector('.pc-rescale-min') as HTMLInputElement)?.value;
    const rescaleMax = (this._contentEl?.querySelector('.pc-rescale-max') as HTMLInputElement)?.value;
    const colormap = (this._contentEl?.querySelector('.pc-colormap-select') as HTMLSelectElement)?.value;
    const expression = (this._contentEl?.querySelector('.pc-expression-input') as HTMLInputElement)?.value;

    const renderParams: TileParams = {};

    if (assetSelect?.value) {
      renderParams.assets = [assetSelect.value];
    }

    if (rescaleMin && rescaleMax) {
      renderParams.rescale = `${rescaleMin},${rescaleMax}`;
    }

    if (colormap) {
      renderParams.colormap_name = colormap;
    }

    if (expression) {
      renderParams.expression = expression;
      delete renderParams.assets;
    }

    return renderParams;
  }

  /**
   * Gets advanced render parameters from the item detail form.
   */
  private _getAdvancedRenderParams(): TileParams {
    const tileFormat = (this._contentEl?.querySelector('.pc-tile-format') as HTMLSelectElement)?.value;
    const tileScale = (this._contentEl?.querySelector('.pc-tile-scale') as HTMLSelectElement)?.value;
    const minzoom = (this._contentEl?.querySelector('.pc-minzoom') as HTMLInputElement)?.value;
    const maxzoom = (this._contentEl?.querySelector('.pc-maxzoom') as HTMLInputElement)?.value;
    const colorFormula = (this._contentEl?.querySelector('.pc-color-formula') as HTMLInputElement)?.value;
    const nodata = (this._contentEl?.querySelector('.pc-nodata') as HTMLInputElement)?.value;
    const buffer = (this._contentEl?.querySelector('.pc-buffer') as HTMLInputElement)?.value;
    const unscale = (this._contentEl?.querySelector('.pc-unscale') as HTMLInputElement)?.checked;
    const assetAsBand = (this._contentEl?.querySelector('.pc-asset-as-band') as HTMLInputElement)?.checked;
    const returnMask = (this._contentEl?.querySelector('.pc-return-mask') as HTMLInputElement)?.checked;

    const params: TileParams = {};

    if (tileFormat) {
      params.tile_format = tileFormat as TileParams['tile_format'];
    }
    if (tileScale) {
      params.tile_scale = parseInt(tileScale) as TileParams['tile_scale'];
    }
    if (minzoom) {
      params.minzoom = parseInt(minzoom);
    }
    if (maxzoom) {
      params.maxzoom = parseInt(maxzoom);
    }
    if (colorFormula) {
      params.color_formula = colorFormula;
    }
    if (nodata) {
      params.nodata = parseFloat(nodata);
    }
    if (buffer) {
      params.buffer = parseInt(buffer);
    }
    if (unscale) {
      params.unscale = true;
    }
    if (assetAsBand) {
      params.asset_as_band = true;
    }
    if (returnMask) {
      params.return_mask = true;
    }

    return params;
  }

  /**
   * Loads item statistics and renders them in the item detail panel.
   */
  private async _loadItemStatistics(item: STACItem, renderParams: TileParams): Promise<Record<string, unknown> | null> {
    const collectionId = item.collection;
    const output = this._contentEl?.querySelector('.pc-stats-output') as HTMLElement;
    if (!collectionId || !output) return null;

    output.innerHTML = '<div class="pc-tool-loading">Loading statistics...</div>';

    try {
      const statistics = await this._tilerClient.getItemStatistics(collectionId, item.id, {
        ...renderParams,
        histogram_bins: 20,
        max_size: 1024,
      });
      output.innerHTML = this._renderStatisticsOutput(statistics);
      return statistics;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load statistics';
      output.innerHTML = `<div class="pc-tool-error">${errorMessage}</div>`;
      return null;
    }
  }

  /**
   * Applies a min/max stretch from item statistics to the custom render form.
   */
  private async _autoStretchItem(item: STACItem, renderParams: TileParams): Promise<void> {
    const statistics = await this._loadItemStatistics(item, renderParams);
    if (!statistics) return;

    const band = this._findFirstBandStatistics(statistics);
    const output = this._contentEl?.querySelector('.pc-stats-output') as HTMLElement;
    if (!band) {
      if (output) {
        output.innerHTML = '<div class="pc-tool-error">No numeric band statistics were found.</div>';
      }
      return;
    }

    const presetSelect = this._contentEl?.querySelector('.pc-preset-select') as HTMLSelectElement;
    const customViz = this._contentEl?.querySelector('.pc-custom-viz') as HTMLElement;
    const minInput = this._contentEl?.querySelector('.pc-rescale-min') as HTMLInputElement;
    const maxInput = this._contentEl?.querySelector('.pc-rescale-max') as HTMLInputElement;
    const assetSelect = this._contentEl?.querySelector('.pc-asset-select') as HTMLSelectElement;
    const expressionInput = this._contentEl?.querySelector('.pc-expression-input') as HTMLInputElement;

    if (presetSelect) {
      presetSelect.value = '';
    }
    if (customViz) {
      customViz.style.display = 'flex';
    }
    if (renderParams.assets?.[0] && assetSelect) {
      assetSelect.value = renderParams.assets[0];
    }
    if (renderParams.expression && expressionInput) {
      expressionInput.value = renderParams.expression;
    }
    if (minInput) {
      minInput.value = String(band.stats.min);
    }
    if (maxInput) {
      maxInput.value = String(band.stats.max);
    }

    if (output) {
      output.innerHTML = `
        <div class="pc-tool-success">Applied stretch ${this._formatNumber(band.stats.min)} to ${this._formatNumber(band.stats.max)} from ${band.label}.</div>
        ${this._renderStatisticsOutput(statistics)}
      `;
    }
  }

  /**
   * Opens a rendered item preview in a new browser tab.
   */
  private _openItemPreview(item: STACItem, renderParams: TileParams): void {
    if (!item.collection) return;

    const url = this._tilerClient.getItemPreviewUrl(item.collection, item.id, renderParams);
    window.open(url, '_blank');
  }

  /**
   * Opens a rendered bbox image in a new browser tab.
   */
  private _openItemBboxImage(item: STACItem, renderParams: TileParams): void {
    if (!item.collection || !this._state.drawnBbox) return;

    const url = this._tilerClient.getItemBboxImageUrl(
      item.collection,
      item.id,
      this._state.drawnBbox,
      { width: 768, height: 512 },
      renderParams
    );
    window.open(url, '_blank');
  }

  /**
   * Shows the legend for the current named colormap.
   */
  private _showRenderLegend(renderParams: TileParams): void {
    const output = this._contentEl?.querySelector('.pc-stats-output') as HTMLElement;
    if (!output) return;

    if (!renderParams.colormap_name) {
      output.innerHTML = '<div class="pc-tool-error">Choose a named colormap to generate a legend.</div>';
      return;
    }

    output.innerHTML = this._renderLegend(renderParams.colormap_name);
  }

  /**
   * Loads and renders TileJSON metadata for an item.
   */
  private async _loadItemTileJSON(item: STACItem, renderParams: TileParams): Promise<void> {
    const collectionId = item.collection;
    const output = this._contentEl?.querySelector('.pc-stats-output') as HTMLElement;
    if (!collectionId || !output) return;

    output.innerHTML = '<div class="pc-tool-loading">Loading TileJSON...</div>';

    try {
      const tilejson = await this._tilerClient.getItemTileJSON(collectionId, item.id, renderParams);
      const bounds = Array.isArray(tilejson.bounds) ? tilejson.bounds.join(', ') : 'n/a';
      const center = Array.isArray(tilejson.center) ? tilejson.center.join(', ') : 'n/a';
      output.innerHTML = `
        <div class="pc-tilejson-card">
          <div><span>Bounds</span><strong>${this._escapeHtml(bounds)}</strong></div>
          <div><span>Center</span><strong>${this._escapeHtml(center)}</strong></div>
          <div><span>Min Zoom</span><strong>${this._escapeHtml(String(tilejson.minzoom ?? 'n/a'))}</strong></div>
          <div><span>Max Zoom</span><strong>${this._escapeHtml(String(tilejson.maxzoom ?? 'n/a'))}</strong></div>
          <div><span>Tiles</span><strong>${this._escapeHtml(String(tilejson.tiles?.length || 0))}</strong></div>
        </div>
      `;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load TileJSON';
      output.innerHTML = `<div class="pc-tool-error">${this._escapeHtml(errorMessage)}</div>`;
    }
  }

  /**
   * Renders a legend ramp for a named colormap.
   */
  private _renderLegend(colormapName: string): string {
    const gradient = this._getColormapGradient(colormapName);
    return `
      <div class="pc-legend-card">
        <div class="pc-legend-title">${this._escapeHtml(colormapName)}</div>
        <div class="pc-legend-ramp" style="background:${gradient}"></div>
        <div class="pc-legend-labels">
          <span>Low</span>
          <span>High</span>
        </div>
      </div>
    `;
  }

  /**
   * Gets a CSS gradient approximation for a named colormap.
   */
  private _getColormapGradient(colormapName: string): string {
    const gradients: Record<string, string> = {
      viridis: 'linear-gradient(to right, #440154, #414487, #2a788e, #22a884, #7ad151, #fde725)',
      plasma: 'linear-gradient(to right, #0d0887, #6a00a8, #b12a90, #e16462, #fca636, #f0f921)',
      inferno: 'linear-gradient(to right, #000004, #420a68, #932667, #dd513a, #fca50a, #fcffa4)',
      magma: 'linear-gradient(to right, #000004, #3b0f70, #8c2981, #de4968, #fe9f6d, #fcfdbf)',
      cividis: 'linear-gradient(to right, #00204c, #424086, #6c6f7c, #9b9e67, #d6d04d, #ffffe5)',
      terrain: 'linear-gradient(to right, #333399, #00a6ca, #4ac16d, #f5d76e, #b07d45, #ffffff)',
      rdylgn: 'linear-gradient(to right, #a50026, #f46d43, #fee08b, #ffffbf, #d9ef8b, #66bd63, #006837)',
      rdylbu: 'linear-gradient(to right, #a50026, #f46d43, #fee090, #ffffbf, #e0f3f8, #74add1, #313695)',
      spectral: 'linear-gradient(to right, #9e0142, #d53e4f, #f46d43, #fee08b, #ffffbf, #e6f598, #66c2a5, #3288bd, #5e4fa2)',
      coolwarm: 'linear-gradient(to right, #3b4cc0, #7093f3, #dddcdc, #f7a889, #b40426)',
      blues: 'linear-gradient(to right, #f7fbff, #deebf7, #9ecae1, #4292c6, #084594)',
      greens: 'linear-gradient(to right, #f7fcf5, #c7e9c0, #74c476, #238b45, #00441b)',
      reds: 'linear-gradient(to right, #fff5f0, #fcbba1, #fb6a4a, #cb181d, #67000d)',
      greys: 'linear-gradient(to right, #ffffff, #d9d9d9, #969696, #525252, #000000)',
      ylgnbu: 'linear-gradient(to right, #ffffd9, #c7e9b4, #41b6c4, #2c7fb8, #081d58)',
      rainbow: 'linear-gradient(to right, #6e40aa, #4776d0, #1f9e89, #6cc24a, #f5d547, #f98e2b, #d23b3b)',
    };

    return gradients[colormapName] || 'linear-gradient(to right, #000000, #ffffff)';
  }

  /**
   * Finds the first numeric band statistics object in a Data API response.
   */
  private _findFirstBandStatistics(data: unknown, label: string = 'band'): { label: string; stats: BandStatistics } | null {
    if (!data || typeof data !== 'object') return null;

    const record = data as Record<string, unknown>;
    if (
      typeof record.min === 'number' &&
      typeof record.max === 'number' &&
      typeof record.mean === 'number'
    ) {
      return { label, stats: record as BandStatistics };
    }

    for (const [key, value] of Object.entries(record)) {
      const found = this._findFirstBandStatistics(value, key);
      if (found) return found;
    }

    return null;
  }

  /**
   * Renders a compact statistics panel.
   */
  private _renderStatisticsOutput(statistics: Record<string, unknown>): string {
    const band = this._findFirstBandStatistics(statistics);
    if (!band) {
      return '<div class="pc-tool-error">No numeric band statistics were found.</div>';
    }

    const stats = band.stats;
    return `
      <div class="pc-stats-card">
        <div class="pc-stats-title">${band.label}</div>
        <div class="pc-stats-grid">
          <div><span>Min</span><strong>${this._formatNumber(stats.min)}</strong></div>
          <div><span>Max</span><strong>${this._formatNumber(stats.max)}</strong></div>
          <div><span>Mean</span><strong>${this._formatNumber(stats.mean)}</strong></div>
          <div><span>Std</span><strong>${this._formatNumber(stats.std)}</strong></div>
          <div><span>Valid</span><strong>${this._formatNumber(stats.valid_percent)}%</strong></div>
          <div><span>Pixels</span><strong>${this._formatNumber(stats.valid_pixels)}</strong></div>
        </div>
        ${this._renderHistogram(stats)}
      </div>
    `;
  }

  /**
   * Renders a tiny histogram from band statistics.
   */
  private _renderHistogram(stats: BandStatistics): string {
    const counts = stats.histogram?.[0];
    if (!Array.isArray(counts) || counts.length === 0) return '';

    const maxCount = Math.max(...counts.map((count) => Number(count) || 0));
    if (maxCount <= 0) return '';

    return `
      <div class="pc-histogram" aria-label="Histogram">
        ${counts
          .map((count) => {
            const height = Math.max(2, Math.round(((Number(count) || 0) / maxCount) * 36));
            return `<span style="height:${height}px"></span>`;
          })
          .join('')}
      </div>
    `;
  }

  /**
   * Formats numeric output for compact display.
   */
  private _formatNumber(value: unknown): string {
    if (typeof value !== 'number' || !isFinite(value)) return 'n/a';
    if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (Math.abs(value) >= 10) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  /**
   * Escapes text for HTML rendering.
   */
  private _escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Renders layers view.
   */
  private _renderLayers(): void {
    if (!this._contentEl) return;

    const layers = this._state.activeLayers;

    if (layers.length === 0) {
      this._contentEl.innerHTML = `
        <div class="pc-layers-empty">
          <p>No layers added yet.</p>
          <p>Search for data and add items to the map.</p>
        </div>
      `;
      return;
    }

    this._contentEl.innerHTML = `
      <div class="pc-layers-list">
        ${this._renderInspectorOutput()}
        ${layers
          .map(
            (layer) => `
          <div class="pc-layer-item" data-id="${layer.id}">
            <div class="pc-layer-header">
              <input type="checkbox" class="pc-layer-visibility" ${layer.visible ? 'checked' : ''}>
              <span class="pc-layer-name" title="${layer.item?.id || layer.collection?.title || layer.id}">
                ${layer.item?.id || layer.collection?.title || layer.id}
              </span>
              <button type="button" class="pc-btn-icon pc-toggle-layer-controls${
                layer.showControls ? ' pc-layer-controls-active' : ''
              }" title="${layer.showControls ? 'Hide opacity and colormap' : 'Show opacity and colormap'}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 21v-7"/>
                  <path d="M4 10V3"/>
                  <path d="M12 21v-9"/>
                  <path d="M12 8V3"/>
                  <path d="M20 21v-5"/>
                  <path d="M20 12V3"/>
                  <path d="M2 14h4"/>
                  <path d="M10 8h4"/>
                  <path d="M18 16h4"/>
                </svg>
              </button>
              ${
                layer.item
                  ? `<button type="button" class="pc-btn-icon pc-inspect-layer${
                      this._inspectorLayerId === layer.id ? ' pc-inspect-active' : ''
                    }" title="${this._inspectorLayerId === layer.id ? 'Stop inspecting' : 'Inspect pixel values'}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 2v4"/>
                  <path d="M12 18v4"/>
                  <path d="M2 12h4"/>
                  <path d="M18 12h4"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>`
                  : ''
              }
              <button type="button" class="pc-btn-icon pc-zoom-to" title="Zoom to layer">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="M21 21l-4.35-4.35"/>
                </svg>
              </button>
              <button type="button" class="pc-btn-icon pc-remove-layer" title="Remove">&times;</button>
            </div>
            <div class="pc-layer-controls${layer.showControls ? '' : ' pc-layer-controls-hidden'}">
              <label class="pc-opacity-label">
                Opacity: <span class="pc-opacity-value">${Math.round(layer.opacity * 100)}%</span>
              </label>
              <input type="range" class="pc-opacity-slider" min="0" max="100" value="${Math.round(layer.opacity * 100)}">
              ${layer.renderParams.colormap_name ? this._renderLegend(layer.renderParams.colormap_name) : ''}
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;

    this._contentEl.querySelectorAll('.pc-layer-item').forEach((el) => {
      const layerId = el.getAttribute('data-id');
      if (!layerId) return;

      const visibility = el.querySelector('.pc-layer-visibility') as HTMLInputElement;
      const slider = el.querySelector('.pc-opacity-slider') as HTMLInputElement;
      const opacityValue = el.querySelector('.pc-opacity-value') as HTMLElement;

      visibility?.addEventListener('change', () => {
        this.updateLayer(layerId, { visible: visibility.checked });
      });

      el.querySelector('.pc-toggle-layer-controls')?.addEventListener('click', () => {
        const layer = this._state.activeLayers.find((activeLayer) => activeLayer.id === layerId);
        this.updateLayer(layerId, { showControls: !layer?.showControls });
        this._renderContent();
      });

      slider?.addEventListener('input', () => {
        const opacity = parseInt(slider.value) / 100;
        opacityValue.textContent = `${slider.value}%`;
        this.updateLayer(layerId, { opacity });
      });

      el.querySelector('.pc-zoom-to')?.addEventListener('click', () => {
        this.zoomToLayer(layerId);
      });

      el.querySelector('.pc-remove-layer')?.addEventListener('click', () => {
        this.removeLayer(layerId);
      });

      el.querySelector('.pc-inspect-layer')?.addEventListener('click', () => {
        if (this._inspectorLayerId === layerId) {
          this._stopInspector();
        } else {
          this._startInspector(layerId);
        }
      });
    });
  }

  /**
   * Starts map click inspection for an item layer.
   */
  private _startInspector(layerId: string): void {
    if (!this._map || !this._layerManager) return;

    const layer = this._layerManager.getLayer(layerId);
    if (!layer?.item?.collection) return;

    this._stopInspector(false);
    this._inspectorLayerId = layerId;
    this._inspectorResult = null;
    this._mapContainer?.classList.add('pc-inspector-active');

    this._inspectClickHandler = (event: MapMouseEvent) => {
      this._queryInspectorPoint(layerId, event.lngLat.lng, event.lngLat.lat);
    };

    this._map.on('click', this._inspectClickHandler);
    this._renderContent();
  }

  /**
   * Stops map click inspection.
   */
  private _stopInspector(render = true): void {
    if (this._inspectClickHandler && this._map) {
      this._map.off('click', this._inspectClickHandler);
    }

    this._inspectClickHandler = null;
    this._inspectorLayerId = null;
    this._inspectorResult = null;
    this._mapContainer?.classList.remove('pc-inspector-active');

    if (render) {
      this._renderContent();
    }
  }

  /**
   * Queries Data API point values for the active inspector layer.
   */
  private async _queryInspectorPoint(layerId: string, lon: number, lat: number): Promise<void> {
    const layer = this._layerManager?.getLayer(layerId);
    if (!layer?.item?.collection) return;

    if (!this._itemBboxContainsPoint(layer.item, lon, lat)) {
      this._inspectorResult = {
        layerId,
        lon,
        lat,
        loading: false,
        error: 'Clicked outside this item footprint. Click inside the visible footprint to inspect pixel values.',
      };
      this._renderContent();
      return;
    }

    this._inspectorResult = {
      layerId,
      lon,
      lat,
      loading: true,
    };
    this._renderContent();

    try {
      const data = await this._tilerClient.getItemPoint(
        layer.item.collection,
        layer.item.id,
        lon,
        lat,
        layer.renderParams
      );

      if (this._inspectorLayerId !== layerId) return;

      this._inspectorResult = {
        layerId,
        lon,
        lat,
        loading: false,
        data,
      };
    } catch (error) {
      if (this._inspectorLayerId !== layerId) return;

      this._inspectorResult = {
        layerId,
        lon,
        lat,
        loading: false,
        error: this._getInspectorErrorMessage(error),
      };
    }

    this._renderContent();
  }

  /**
   * Checks whether a coordinate is inside a STAC item's bbox.
   */
  private _itemBboxContainsPoint(item: STACItem, lon: number, lat: number): boolean {
    if (!item.bbox || item.bbox.length < 4) return true;

    const [west, south, east, north] = item.bbox;
    if (![west, south, east, north].every((value) => Number.isFinite(value))) return true;

    return lon >= west && lon <= east && lat >= south && lat <= north;
  }

  /**
   * Converts point query failures into user-facing inspector messages.
   */
  private _getInspectorErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message.trim() : '';

    if (!message || message === 'Failed to get point values:' || message === 'Failed to get point values') {
      return 'No pixel value was returned for this location. Try a point inside the layer footprint and away from nodata areas.';
    }

    if (/not found|outside|bounds|intersect|empty|no data|nodata/i.test(message)) {
      return 'No pixel value is available at this location. The click may be outside valid data or over a nodata pixel.';
    }

    return message;
  }

  /**
   * Renders pixel inspector status and results.
   */
  private _renderInspectorOutput(): string {
    if (!this._inspectorLayerId) return '';

    const layer = this._state.activeLayers.find((activeLayer) => activeLayer.id === this._inspectorLayerId);
    const layerName = layer?.item?.id || layer?.id || this._inspectorLayerId;
    const result = this._inspectorResult;

    if (!result) {
      return `
        <div class="pc-inspector-panel">
          <div class="pc-inspector-title">Inspecting ${this._escapeHtml(layerName)}</div>
          <div class="pc-inspector-hint">Click the map to query pixel values.</div>
        </div>
      `;
    }

    if (result.loading) {
      return `
        <div class="pc-inspector-panel">
          <div class="pc-inspector-title">Inspecting ${this._escapeHtml(layerName)}</div>
          <div class="pc-tool-loading">Querying ${this._formatNumber(result.lon)}, ${this._formatNumber(result.lat)}...</div>
        </div>
      `;
    }

    if (result.error) {
      return `
        <div class="pc-inspector-panel">
          <div class="pc-inspector-title">Inspecting ${this._escapeHtml(layerName)}</div>
          <div class="pc-tool-error">${this._escapeHtml(result.error)}</div>
        </div>
      `;
    }

    return `
      <div class="pc-inspector-panel">
        <div class="pc-inspector-title">Inspecting ${this._escapeHtml(layerName)}</div>
        <div class="pc-inspector-coords">${this._formatNumber(result.lon)}, ${this._formatNumber(result.lat)}</div>
        ${this._renderPointValues(result.data)}
      </div>
    `;
  }

  /**
   * Renders point values from a Data API point response.
   */
  private _renderPointValues(data?: PointValueResponse): string {
    if (!data) return '';

    if (Array.isArray(data.values)) {
      return `
        <div class="pc-point-values">
          ${data.values
            .map((value, index) => {
              const label = data.band_names?.[index] || `Band ${index + 1}`;
              return `
                <div>
                  <span>${this._escapeHtml(label)}</span>
                  <strong>${this._escapeHtml(this._formatPointValue(value))}</strong>
                </div>
              `;
            })
            .join('')}
        </div>
      `;
    }

    return `<pre class="pc-point-json">${this._escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  }

  /**
   * Formats a point value.
   */
  private _formatPointValue(value: unknown): string {
    if (typeof value === 'number') return this._formatNumber(value);
    if (value === null || value === undefined) return 'n/a';
    if (Array.isArray(value)) return value.map((entry) => this._formatPointValue(entry)).join(', ');
    return String(value);
  }

  /**
   * Loads collections from STAC API.
   */
  private async _loadCollections(): Promise<STACCollection[]> {
    this._state.collectionsLoading = true;
    this._state.error = null;
    this._emit('statechange');
    this._renderContent();

    try {
      const collections = await this._stacClient.getCollections();

      // Filter by default collections if specified
      if (this._options.defaultCollections.length > 0) {
        this._state.collections = collections.filter((c) =>
          this._options.defaultCollections.includes(c.id)
        );
      } else {
        this._state.collections = collections;
      }

      // Sort by title
      this._state.collections.sort((a, b) =>
        (a.title || a.id).localeCompare(b.title || b.id)
      );

      this._emit('collections:load');
      return this._state.collections;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load collections';
      this._state.error = errorMessage;
      this._emit('error');
      throw error;
    } finally {
      this._state.collectionsLoading = false;
      this._emit('statechange');
      this._renderContent();
    }
  }

  /**
   * Updates panel visibility.
   */
  private _updatePanelVisibility(): void {
    if (this._panel) {
      if (this._state.collapsed) {
        this._panel.classList.remove('expanded');
      } else {
        this._panel.classList.add('expanded');
        this._updatePanelPosition();
      }
    }
  }

  /**
   * Sets up event listeners.
   */
  private _setupEventListeners(): void {
    this._clickOutsideHandler = (e: MouseEvent) => {
      if (this._ignoreNextDocumentClick) {
        this._ignoreNextDocumentClick = false;
        return;
      }
      if (this._state.bboxSelectorActive || this._inspectorLayerId) return;

      const target = e.target as Node;
      if (
        this._container &&
        this._panel &&
        !this._container.contains(target) &&
        !this._panel.contains(target)
      ) {
        this.collapse();
      }
    };
    document.addEventListener('click', this._clickOutsideHandler);

    this._resizeHandler = () => {
      if (!this._state.collapsed) {
        this._updatePanelPosition();
      }
    };
    window.addEventListener('resize', this._resizeHandler);

    this._mapResizeHandler = () => {
      if (!this._state.collapsed) {
        this._updatePanelPosition();
      }
    };
    this._map?.on('resize', this._mapResizeHandler);
  }

  /**
   * Gets control position.
   */
  private _getControlPosition(): 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' {
    const parent = this._container?.parentElement;
    if (!parent) return 'top-right';

    if (parent.classList.contains('maplibregl-ctrl-top-left')) return 'top-left';
    if (parent.classList.contains('maplibregl-ctrl-top-right')) return 'top-right';
    if (parent.classList.contains('maplibregl-ctrl-bottom-left')) return 'bottom-left';
    if (parent.classList.contains('maplibregl-ctrl-bottom-right')) return 'bottom-right';

    return 'top-right';
  }

  /**
   * Updates panel position.
   */
  private _updatePanelPosition(): void {
    if (!this._container || !this._panel || !this._mapContainer) return;

    const button = this._container.querySelector('.pc-control-toggle');
    if (!button) return;

    const buttonRect = button.getBoundingClientRect();
    const mapRect = this._mapContainer.getBoundingClientRect();
    const position = this._getControlPosition();

    const buttonTop = buttonRect.top - mapRect.top;
    const buttonBottom = mapRect.bottom - buttonRect.bottom;
    const buttonLeft = buttonRect.left - mapRect.left;
    const buttonRight = mapRect.right - buttonRect.right;

    const panelGap = 5;

    this._panel.style.top = '';
    this._panel.style.bottom = '';
    this._panel.style.left = '';
    this._panel.style.right = '';

    switch (position) {
      case 'top-left':
        this._panel.style.top = `${buttonTop + buttonRect.height + panelGap}px`;
        this._panel.style.left = `${buttonLeft}px`;
        break;
      case 'top-right':
        this._panel.style.top = `${buttonTop + buttonRect.height + panelGap}px`;
        this._panel.style.right = `${buttonRight}px`;
        break;
      case 'bottom-left':
        this._panel.style.bottom = `${buttonBottom + buttonRect.height + panelGap}px`;
        this._panel.style.left = `${buttonLeft}px`;
        break;
      case 'bottom-right':
        this._panel.style.bottom = `${buttonBottom + buttonRect.height + panelGap}px`;
        this._panel.style.right = `${buttonRight}px`;
        break;
    }
  }

  getPanelElement(): HTMLElement | null {
    return this._panel ?? null;
  }
}
