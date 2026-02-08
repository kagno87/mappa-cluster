mapboxgl.accessToken =
  'pk.eyJ1IjoicGluZ2VvIiwiYSI6ImNtazl2NHducTFlcDUzZXNoMTd0ZzdxMDcifQ.Y9JlBgOGjtP9olv54nHE3g';

/* ========= MAP ========= */
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/light-v11',
  center: [9.2, 45.5],
  zoom: 6
});

/* ========= STILI BASE ========= */
const BASE_STYLES = {
  light: 'mapbox://styles/mapbox/light-v11',
  satellite: 'mapbox://styles/pingeo/cmldojdsl00bg01sjejrzdjzk'
};

let currentBaseStyleKey = 'light';

/* ========= PANEL HEIGHT (DEVE STARE QUI, IN ALTO) ========= */
function updatePanelHeight() {
  const panel = document.getElementById('panel');
  if (!panel || !map) return;

  const height = panel.offsetHeight;

  document.documentElement.style.setProperty('--panel-height', `${height}px`);

  // 🔑 IMPORTANTISSIMO: il canvas deve adattarsi al nuovo size del container
  requestAnimationFrame(() => {
    map.resize();

    map.setPadding({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0
    });
  });
}


/* ========= CONTROLLO SWITCHER MAP/SAT ========= */
class MapStyleSwitcherControl {
  onAdd(mapInstance) {
    this.map = mapInstance;

    const container = document.createElement('div');
    container.className = 'mapboxgl-ctrl map-style-switcher';

    const group = document.createElement('div');
    group.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';

    const btnMap = document.createElement('button');
    btnMap.type = 'button';
    btnMap.title = 'Map';
    btnMap.textContent = 'MAP';

    const btnSat = document.createElement('button');
    btnSat.type = 'button';
    btnSat.title = 'Satellite';
    btnSat.textContent = 'SAT';

    const setActiveUI = () => {
      btnMap.classList.toggle('is-active', currentBaseStyleKey === 'light');
      btnSat.classList.toggle('is-active', currentBaseStyleKey === 'satellite');
    };

    btnMap.addEventListener('click', () => {
      if (currentBaseStyleKey === 'light') return;
      currentBaseStyleKey = 'light';
      setActiveUI();
      this.map.setStyle(BASE_STYLES.light);
    });

    btnSat.addEventListener('click', () => {
      if (currentBaseStyleKey === 'satellite') return;
      currentBaseStyleKey = 'satellite';
      setActiveUI();
      this.map.setStyle(BASE_STYLES.satellite);
    });

    group.appendChild(btnMap);
    group.appendChild(btnSat);
    container.appendChild(group);

    setActiveUI();

    this.container = container;
    return container;
  }

  onRemove() {
    this.container?.parentNode?.removeChild(this.container);
    this.map = undefined;
  }
}

/* ========= GEOCODER (solo una volta) ========= */
function setupGeocoderOnce() {
  const searchContainer = document.getElementById('search-container');

  if (
    searchContainer &&
    typeof MapboxGeocoder !== 'undefined' &&
    !searchContainer.querySelector('.mapboxgl-ctrl-geocoder')
  ) {
    const geocoder = new MapboxGeocoder({
      accessToken: mapboxgl.accessToken,
      mapboxgl: mapboxgl,
      marker: false,
      flyTo: { speed: 1.2 },
      language: 'en',
      placeholder: 'Search for a place'
    });

    searchContainer.appendChild(geocoder.onAdd(map));
  }
}

/* ========= TOGGLE LAYER ========= */
const layerGroups = {
  nero: ['clusters-nero', 'clusters-nero-ring', 'nero-points'],
  bianco: ['clusters-bianco', 'clusters-bianco-ring', 'unclustered-point-bianco']
};

function setLayerGroupVisibility(group, visible) {
  const layers = layerGroups[group];
  if (!layers) return;

  layers.forEach(id => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  });
}

function applyLayerToggleState() {
  document.querySelectorAll('.layer-toggle').forEach(toggle => {
    const layerKey = toggle.dataset.layer;
    const visible = toggle.classList.contains('active');
    setLayerGroupVisibility(layerKey, visible);
  });
}

/* ========= INIT DI SOURCES/LAYERS + HANDLERS ========= */
function initDataLayersAndHandlers() {
  addSourcesIfMissing();
  addLayersIfMissing();
  applyLayerToggleState();
  bindMapInteractions();
  updatePanelHeight();
}

function addSourcesIfMissing() {
  if (!map.getSource('nero')) {
    map.addSource('nero', {
      type: 'geojson',
      data: 'nero.geojson',
      cluster: true,
      clusterRadius: 70,
      clusterMaxZoom: 7,
      clusterProperties: {
        maxSize: ['max', ['get', 'size']]
      }
    });
  }

  if (!map.getSource('bianco')) {
    map.addSource('bianco', {
      type: 'geojson',
      data: 'bianco.geojson',
      cluster: true,
      clusterRadius: 70,
      clusterMaxZoom: 7,
      clusterProperties: {
        maxSize: ['max', ['get', 'size']]
      }
    });
  }
}

function addLayersIfMissing() {
  /* ========= CLUSTERS NERO ========= */
  if (!map.getLayer('clusters-nero')) {
    map.addLayer({
      id: 'clusters-nero',
      type: 'circle',
      source: 'nero',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#2c2c2c',
        'circle-radius': ['match', ['get', 'maxSize'], 1, 5, 2, 10, 3, 15, 7],
        'circle-opacity': 1.0,
        'circle-stroke-width': 1.2,
        'circle-stroke-color': '#000000'
      }
    });
  }

  if (!map.getLayer('clusters-nero-ring')) {
    map.addLayer({
      id: 'clusters-nero-ring',
      type: 'circle',
      source: 'nero',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': 'rgba(0,0,0,0)',
        'circle-radius': ['match', ['get', 'maxSize'], 1, 8, 2, 13, 3, 18, 10],
        'circle-stroke-width': 1.2,
        'circle-stroke-color': '#000000',
        'circle-stroke-opacity': 0.5
      }
    });
  }

  if (!map.getLayer('nero-points')) {
    map.addLayer({
      id: 'nero-points',
      type: 'circle',
      source: 'nero',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': '#2c2c2c',
        'circle-radius': ['match', ['get', 'size'], 1, 5, 2, 10, 3, 15, 6],
        'circle-stroke-width': 1.2,
        'circle-stroke-color': '#000000'
      }
    });
  }

  /* ========= CLUSTERS BIANCO ========= */
  if (!map.getLayer('clusters-bianco')) {
    map.addLayer({
      id: 'clusters-bianco',
      type: 'circle',
      source: 'bianco',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': ['match', ['get', 'maxSize'], 1, 5, 2, 10, 3, 15, 7],
        'circle-stroke-width': 1.2,
        'circle-stroke-color': '#000000'
      }
    });
  }

  if (!map.getLayer('clusters-bianco-ring')) {
    map.addLayer({
      id: 'clusters-bianco-ring',
      type: 'circle',
      source: 'bianco',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': 'rgba(0,0,0,0)',
        'circle-radius': ['match', ['get', 'maxSize'], 1, 8, 2, 13, 3, 18, 10],
        'circle-stroke-width': 1.2,
        'circle-stroke-color': '#000000',
        'circle-stroke-opacity': 0.5
      }
    });
  }

  if (!map.getLayer('unclustered-point-bianco')) {
    map.addLayer({
      id: 'unclustered-point-bianco',
      type: 'circle',
      source: 'bianco',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': ['match', ['get', 'size'], 1, 5, 2, 10, 3, 15, 6],
        'circle-stroke-width': 1.2,
        'circle-stroke-color': '#000000'
      }
    });
  }
}

/* ========= HANDLERS MAP (riagganciati dopo setStyle) ========= */
function bindMapInteractions() {
  // Cluster click
  map.off('click', 'clusters-nero', onClickClusterNero);
  map.on('click', 'clusters-nero', onClickClusterNero);

  map.off('click', 'clusters-bianco', onClickClusterBianco);
  map.on('click', 'clusters-bianco', onClickClusterBianco);

  // Cursore pointer
  const layers = ['clusters-nero', 'clusters-bianco', 'nero-points', 'unclustered-point-bianco'];
  layers.forEach(layer => {
    map.off('mouseenter', layer, onEnterPointer);
    map.off('mouseleave', layer, onLeavePointer);
    map.on('mouseenter', layer, onEnterPointer);
    map.on('mouseleave', layer, onLeavePointer);
  });

  // Click pin
  map.off('click', 'nero-points', onClickNeroPoint);
  map.off('click', 'unclustered-point-bianco', onClickBiancoPoint);
  map.on('click', 'nero-points', onClickNeroPoint);
  map.on('click', 'unclustered-point-bianco', onClickBiancoPoint);
}

function onClickClusterNero(e) {
  const f = e.features && e.features[0];
  if (!f) return;

  map.getSource('nero').getClusterExpansionZoom(
    f.properties.cluster_id,
    (err, zoom) => {
      if (!err) map.easeTo({ center: f.geometry.coordinates, zoom });
    }
  );
}

function onClickClusterBianco(e) {
  const f = e.features && e.features[0];
  if (!f) return;

  map.getSource('bianco').getClusterExpansionZoom(
    f.properties.cluster_id,
    (err, zoom) => {
      if (!err) map.easeTo({ center: f.geometry.coordinates, zoom });
    }
  );
}

function onEnterPointer() {
  map.getCanvas().style.cursor = 'pointer';
}

function onLeavePointer() {
  map.getCanvas().style.cursor = '';
}

function onClickNeroPoint(e) {
  updatePanel(e.features[0]);
}

function onClickBiancoPoint(e) {
  updatePanel(e.features[0]);
}

/* ========= PANEL ========= */
function updatePanel(feature) {
  const properties = feature.properties || {};

  /* ====== COORDINATE ====== */
  let coordsText = '';

  if (
    feature.geometry &&
    feature.geometry.type === 'Point' &&
    Array.isArray(feature.geometry.coordinates)
  ) {
    const [lon, lat] = feature.geometry.coordinates;
    coordsText = formatCoords(Number(lat), Number(lon));
  }

  const coordsTextEl = document.getElementById('coords-text');
  if (coordsTextEl) coordsTextEl.textContent = coordsText;

  const overlay = document.querySelector('.image-overlay');

  if (overlay && feature.geometry && feature.geometry.type === 'Point') {
    overlay.dataset.lon = feature.geometry.coordinates[0];
    overlay.dataset.lat = feature.geometry.coordinates[1];
  }

  /* ====== TITOLO ====== */
  const title =
    (properties.name && properties.name.trim()) ||
    (properties.title && properties.title.trim()) ||
    'Senza nome';

  const titleTextEl = document.getElementById('title-text');
  if (titleTextEl) titleTextEl.textContent = title;

  /* ====== DESCRIPTION NORMALIZZATA ====== */
  let htmlContent = '';

  if (properties.description) {
    if (
      typeof properties.description === 'string' &&
      properties.description.trim().startsWith('{')
    ) {
      try {
        const parsed = JSON.parse(properties.description);
        htmlContent = parsed.value || '';
      } catch (e) {
        htmlContent = '';
      }
    } else {
      htmlContent = properties.description;
    }
  }

  /* ====== IMMAGINE ====== */
  let imageUrl = null;

  const imgMatch = htmlContent.match(/<img[^>]+src="([^">]+)"/);
  if (imgMatch && imgMatch[1]) {
    imageUrl = imgMatch[1];
  } else if (properties.gx_media_links) {
    imageUrl = properties.gx_media_links;
  }

  const imgEl = document.getElementById('panel-image');

  if (imgEl && imageUrl) {
    const proxiedUrl =
      'http://localhost:3000/image?url=' + encodeURIComponent(imageUrl);

    preloadImage(proxiedUrl, loadedUrl => {
      if (loadedUrl) {
        imgEl.src = loadedUrl;
        imgEl.style.display = 'block';
      }
    });
  } else if (imgEl) {
    imgEl.style.display = 'none';
  }

  /* ====== COUNTRY ====== */
  const country = (properties.country && properties.country.trim()) || '';

  const overlayDescEl = document.getElementById('overlay-description');
  if (overlayDescEl) overlayDescEl.textContent = country;

  updatePanelHeight();
}

function preloadImage(url, callback) {
  const img = new Image();
  img.onload = () => callback(url);
  img.onerror = () => callback(null);
  img.src = url;
}

function formatCoords(lat, lng, decimals = 4) {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';

  const latFixed = Math.abs(lat).toFixed(decimals);
  const lngFixed = Math.abs(lng).toFixed(decimals);

  return `${latDir} ${latFixed}°, ${lngDir} ${lngFixed}°`;
}

/* ========= COPY BUTTONS ========= */
const copyBtn = document.getElementById('coords-copy');

if (copyBtn) {
  copyBtn.addEventListener('click', e => {
    e.stopPropagation();

    const text = document.getElementById('coords-text')?.textContent;
    if (!text) return;

    navigator.clipboard.writeText(text);
  });
}

const titleCopyBtn = document.getElementById('title-copy');

if (titleCopyBtn) {
  titleCopyBtn.addEventListener('click', e => {
    e.stopPropagation();

    const text = document.getElementById('title-text')?.textContent;
    if (!text) return;

    navigator.clipboard.writeText(text);
  });
}

/* ========= OVERLAY CLICK -> FLYTO ========= */
const overlayEl = document.querySelector('.image-overlay');

if (overlayEl) {
  overlayEl.addEventListener('click', e => {
    if (e.target.closest('button')) return;

    const lon = parseFloat(overlayEl.dataset.lon);
    const lat = parseFloat(overlayEl.dataset.lat);

    if (!isNaN(lon) && !isNaN(lat)) {
      map.easeTo({
        center: [lon, lat],
        duration: 800
      });
    }
  });
}

/* ========= TOOLTIP LAYER INFO ========= */
const layerInfo = document.getElementById('layer-info');
const toggles = document.querySelectorAll('.layer-toggle');

toggles.forEach(toggle => {
  toggle.addEventListener('mouseenter', () => {
    const rect = toggle.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    layerInfo.style.left = `${centerX}px`;
    layerInfo.style.top = `${centerY}px`;

    const text = toggle.dataset.layerInfo || '';
    layerInfo.innerHTML = `<div class="layer-info-title">${text}</div>`;

    layerInfo.hidden = false;
  });

  toggle.addEventListener('mouseleave', () => {
    layerInfo.hidden = true;
  });
});

/* ========= TOGGLE UI CLICK (resta uguale ma ora funziona anche dopo setStyle) ========= */
document.querySelectorAll('.layer-toggle').forEach(toggle => {
  const layerKey = toggle.dataset.layer;
  let active = true;

  toggle.classList.add('active');

  toggle.addEventListener('click', () => {
    active = !active;

    toggle.classList.toggle('active', active);
    setLayerGroupVisibility(layerKey, active);
  });
});

/* ========= LOAD (prima volta) ========= */
map.on('load', () => {
  console.log('Mapbox caricato correttamente');

  updatePanelHeight();

  // controlli
  map.addControl(new mapboxgl.NavigationControl());
  map.addControl(new MapStyleSwitcherControl(), 'top-right');

  setupGeocoderOnce();

  // init per lo stile corrente
  initDataLayersAndHandlers();
});

/* ========= OGNI VOLTA CHE CAMBI STILE ========= */
map.on('style.load', () => {
  initDataLayersAndHandlers();
});

window.addEventListener('resize', updatePanelHeight);
