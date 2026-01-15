import type { IControl, Map as MapLibreMap } from 'maplibre-gl';
import type {
  PlanetaryComputerOptions,
  PlanetaryComputerState,
  PlanetaryComputerEvent,
  PlanetaryComputerEventHandler,
  ActiveLayer,
  PanelView,
} from './types';
import type { STACCollection, STACItem, STACSearchParams, TileParams } from '../api/types';
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
  className: '',
  stacApiUrl: 'https://planetarycomputer.microsoft.com/api/stac/v1',
  tilerApiUrl: 'https://planetarycomputer.microsoft.com/api/data/v1',
  defaultCollections: [],
  enableBboxSelector: true,
  maxSearchResults: 50,
  autoLoadCollections: true,
};

/**
 * Event handlers map type.
 */
type EventHandlersMap = globalThis.Map<PlanetaryComputerEvent, Set<PlanetaryComputerEventHandler>>;

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

    try {
      const results = await this._stacClient.search(searchParams);
      this._state.searchResults = results;
      this._state.activeView = 'results';
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
    this._state.selectedCollection = collection;
    this._state.searchParams = collection ? { collections: [collection.id] } : {};
    this._state.activeView = collection ? 'search' : 'collections';
    this._state.searchResults = [];
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
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <rect x="2" y="2" width="9" height="9" rx="1" fill="#f25022"/>
          <rect x="13" y="2" width="9" height="9" rx="1" fill="#7fba00"/>
          <rect x="2" y="13" width="9" height="9" rx="1" fill="#00a4ef"/>
          <rect x="13" y="13" width="9" height="9" rx="1" fill="#ffb900"/>
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
        </div>

        <div class="pc-form-group">
          <label class="pc-label">Bounding Box</label>
          <div class="pc-bbox-display">
            <span class="pc-bbox-text">${
              this._state.drawnBbox ? formatBbox(this._state.drawnBbox) : 'Use current map view'
            }</span>
            <button type="button" class="pc-btn pc-btn-small pc-use-view">Use Map View</button>
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

        <button type="button" class="pc-btn pc-btn-primary pc-search-btn">
          Search Items
        </button>
      </div>
    `;

    // Event handlers
    this._contentEl.querySelector('.pc-btn-back')?.addEventListener('click', () => {
      this.selectCollection(null);
    });

    this._contentEl.querySelector('.pc-use-view')?.addEventListener('click', () => {
      if (this._map) {
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

    // Cloud cover slider
    const cloudSlider = this._contentEl.querySelector('.pc-cloud-slider') as HTMLInputElement;
    const cloudValue = this._contentEl.querySelector('.pc-cloud-value');
    if (cloudSlider && cloudValue) {
      cloudSlider.addEventListener('input', () => {
        cloudValue.textContent = `${cloudSlider.value}%`;
      });
    }

    this._contentEl.querySelector('.pc-search-btn')?.addEventListener('click', () => {
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

    this._contentEl.innerHTML = `
      <div class="pc-results">
        <div class="pc-results-header">
          <button type="button" class="pc-btn-back">&larr; Back</button>
          <span class="pc-results-count">${results.length} items found</span>
        </div>
        <div class="pc-results-list">
          ${
            results.length === 0
              ? '<div class="pc-results-empty">No items found. Try adjusting your search.</div>'
              : results
                  .map(
                    (item) => `
                <div class="pc-result-item" data-id="${item.id}">
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

          <div class="pc-custom-viz" ${presets.length ? 'style="display:none"' : ''}>
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
          </div>
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
      this.selectItem(null);
    });

    this._contentEl.querySelector('.pc-add-to-map')?.addEventListener('click', () => {
      const presetName = (this._contentEl?.querySelector('.pc-preset-select') as HTMLSelectElement)?.value;
      let layer;

      if (presetName) {
        // Use preset
        const preset = presets.find((p) => p.name === presetName);
        layer = this.addItemLayer(item, preset ? { presetName, renderParams: preset.params } : undefined);
      } else {
        // Use custom visualization params
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
          delete renderParams.assets; // Expression overrides asset selection
        }

        layer = this.addItemLayer(item, { renderParams });
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
        ${layers
          .map(
            (layer) => `
          <div class="pc-layer-item" data-id="${layer.id}">
            <div class="pc-layer-header">
              <input type="checkbox" class="pc-layer-visibility" ${layer.visible ? 'checked' : ''}>
              <span class="pc-layer-name" title="${layer.item?.id || layer.collection?.title || layer.id}">
                ${layer.item?.id || layer.collection?.title || layer.id}
              </span>
              <button type="button" class="pc-btn-icon pc-zoom-to" title="Zoom to layer">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="M21 21l-4.35-4.35"/>
                </svg>
              </button>
              <button type="button" class="pc-btn-icon pc-remove-layer" title="Remove">&times;</button>
            </div>
            <div class="pc-layer-controls">
              <label class="pc-opacity-label">
                Opacity: <span class="pc-opacity-value">${Math.round(layer.opacity * 100)}%</span>
              </label>
              <input type="range" class="pc-opacity-slider" min="0" max="100" value="${Math.round(layer.opacity * 100)}">
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
    });
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
}
