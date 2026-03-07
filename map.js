mapboxgl.accessToken = window.MAPBOX_TOKEN;

/* ========= MAP ========= */
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/pingeo/cmle3qgj100br01s9fgb3gbo3',
  center: [9.2, 45.5],
  zoom: 6
});

window.addEventListener('DOMContentLoaded', () => {
  updatePanelScale();
  updatePanelHeight();
});

/* ========= STILI BASE ========= */
const BASE_STYLES = {
  light: 'mapbox://styles/pingeo/cmle3qgj100br01s9fgb3gbo3',
  satellite: 'mapbox://styles/pingeo/cmldojdsl00bg01sjejrzdjzk'
};

let currentBaseStyleKey = 'light';
let startupRandomShown = false;
let activeCrosshair = null;
let crosshairRequestToken = 0;

/* ========= PANEL HEIGHT ========= */
function updatePanelHeight() {
  const strip = document.getElementById('panel-strip');
  if (strip) strip.style.opacity = 1;

  const panel = document.getElementById('panel');
  if (!panel) return;

  const height = panel.offsetHeight;

  document.documentElement.style.setProperty('--panel-height', `${height}px`);

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

function updatePanelScale() {
  const panel = document.getElementById('panel');
  if (!panel) return;

  const n = 5;
  const gap = 10;
  const sidePadding = 20;
  const baseW = 380;
  const baseH = 280;

  const available = panel.clientWidth - sidePadding;
  const maxCardW = (available - gap * (n - 1)) / n;

  const scale = Math.min(1, maxCardW / baseW);

  document.documentElement.style.setProperty('--card-w', `${baseW * scale}px`);
  document.documentElement.style.setProperty('--card-h', `${baseH * scale}px`);
  document.documentElement.style.setProperty('--card-scale', scale.toFixed(3));
}

/* ========= CONTROLLO SWITCHER MAP/SAT ========= */
class ZoomAndStyleControl {
  onAdd(mapInstance) {
    this.map = mapInstance;

    const container = document.createElement('div');
    container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group zoom-style-control';

    const btnPlus = document.createElement('button');
    btnPlus.type = 'button';
    btnPlus.className = 'mapboxgl-ctrl-icon';
    btnPlus.setAttribute('aria-label', 'Zoom in');
    btnPlus.innerHTML = '+';

    const btnMinus = document.createElement('button');
    btnMinus.type = 'button';
    btnMinus.className = 'mapboxgl-ctrl-icon';
    btnMinus.setAttribute('aria-label', 'Zoom out');
    btnMinus.innerHTML = '–';

    const divider = document.createElement('div');
    divider.className = 'zoom-style-divider';

    const btnMap = document.createElement('button');
    btnMap.type = 'button';
    btnMap.className = 'style-btn';
    btnMap.innerHTML = `<img src="icomap.png" alt="MAP">`;

    const btnSat = document.createElement('button');
    btnSat.type = 'button';
    btnSat.className = 'style-btn';
    btnSat.innerHTML = `<img src="icosat.png" alt="SAT">`;

    const setActiveUI = () => {
      btnMap.classList.toggle('is-active', currentBaseStyleKey === 'light');
      btnSat.classList.toggle('is-active', currentBaseStyleKey === 'satellite');
    };

    btnPlus.addEventListener('click', () => this.map.zoomIn());
    btnMinus.addEventListener('click', () => this.map.zoomOut());

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

    container.appendChild(btnPlus);
    container.appendChild(btnMinus);
    container.appendChild(divider);
    container.appendChild(btnMap);
    container.appendChild(btnSat);

    setActiveUI();

    this.container = container;
    return container;
  }

  onRemove() {
    this.container?.parentNode?.removeChild(this.container);
    this.map = undefined;
  }
}

/* ========= DUAL SCALE (km + mi) ========= */
class DualScaleControl {
  onAdd(mapInstance) {
    this.map = mapInstance;

    const box = document.createElement('div');
    box.className = 'mapboxgl-ctrl dual-scale-box';

    const container = document.createElement('div');
    container.className = 'dual-scale-control';

    const makeItem = (unit) => {
      const item = document.createElement('div');
      item.className = 'dual-scale-item';

      const sc = new mapboxgl.ScaleControl({ maxWidth: 110, unit });
      const scEl = sc.onAdd(mapInstance);

      const label = document.createElement('div');
      label.className = 'dual-scale-label';
      label.textContent = scEl.textContent || '';

      const obs = new MutationObserver(() => {
        label.textContent = scEl.textContent || '';
      });
      obs.observe(scEl, { childList: true, characterData: true, subtree: true });

      this._items = this._items || [];
      this._items.push({ sc, obs });

      item.appendChild(scEl);
      item.appendChild(label);

      return item;
    };

    container.appendChild(makeItem('metric'));
    container.appendChild(makeItem('imperial'));

    box.appendChild(container);

    this.container = box;
    this.inner = container;

    return box;
  }

  onRemove() {
    if (this._items) {
      this._items.forEach(({ sc, obs }) => {
        try { obs?.disconnect(); } catch (e) {}
        try { sc?.onRemove(); } catch (e) {}
      });
    }

    this.container?.parentNode?.removeChild(this.container);
    this.map = undefined;
  }
}

/* ========= HOVER CROSSHAIR ========= */
function getCrosshairMetrics(sizeValue) {
  const size = Number(sizeValue) || 1;

  switch (size) {
    case 1:
      return { gap: 10, arm: 8, stroke: 3 };
    case 2:
      return { gap: 14, arm: 10, stroke: 4 };
    case 3:
      return { gap: 18, arm: 12, stroke: 4 };
    default:
      return { gap: 10, arm: 8, stroke: 3 };
  }
}

function buildCrosshairFeature(lon, lat, sizeValue) {
  const metrics = getCrosshairMetrics(sizeValue);
  const center = map.project([lon, lat]);

  const leftOuter = map.unproject([center.x - (metrics.gap + metrics.arm), center.y]);
  const leftInner = map.unproject([center.x - metrics.gap, center.y]);

  const rightInner = map.unproject([center.x + metrics.gap, center.y]);
  const rightOuter = map.unproject([center.x + metrics.gap + metrics.arm, center.y]);

  const topOuter = map.unproject([center.x, center.y - (metrics.gap + metrics.arm)]);
  const topInner = map.unproject([center.x, center.y - metrics.gap]);

  const bottomInner = map.unproject([center.x, center.y + metrics.gap]);
  const bottomOuter = map.unproject([center.x, center.y + metrics.gap + metrics.arm]);

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          strokeWidth: metrics.stroke
        },
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [[leftOuter.lng, leftOuter.lat], [leftInner.lng, leftInner.lat]],
            [[rightInner.lng, rightInner.lat], [rightOuter.lng, rightOuter.lat]],
            [[topOuter.lng, topOuter.lat], [topInner.lng, topInner.lat]],
            [[bottomInner.lng, bottomInner.lat], [bottomOuter.lng, bottomOuter.lat]]
          ]
        }
      }
    ]
  };
}

function renderCrosshair(lon, lat, sizeValue) {
  if (!map.getSource('hover-crosshair')) return;

  activeCrosshair = {
    lon: Number(lon),
    lat: Number(lat),
    size: Number(sizeValue) || 1
  };

  map.getSource('hover-crosshair').setData(
    buildCrosshairFeature(activeCrosshair.lon, activeCrosshair.lat, activeCrosshair.size)
  );
}

function hideCrosshair() {
  activeCrosshair = null;
  crosshairRequestToken += 1;

  if (!map.getSource('hover-crosshair')) return;

  map.getSource('hover-crosshair').setData({
    type: 'FeatureCollection',
    features: []
  });
}

function refreshCrosshair() {
  if (!activeCrosshair) return;
  if (!map.getSource('hover-crosshair')) return;

  map.getSource('hover-crosshair').setData(
    buildCrosshairFeature(activeCrosshair.lon, activeCrosshair.lat, activeCrosshair.size)
  );
}

function areSameCoordinates(aLon, aLat, bLon, bLat, tolerance = 1e-7) {
  return (
    Math.abs(Number(aLon) - Number(bLon)) <= tolerance &&
    Math.abs(Number(aLat) - Number(bLat)) <= tolerance
  );
}

function getPointLayerIdForSource(sourceKey) {
  return sourceKey === 'nero' ? 'nero-points' : 'unclustered-point-bianco';
}

function getClusterLayerIdForSource(sourceKey) {
  return sourceKey === 'nero' ? 'clusters-nero' : 'clusters-bianco';
}

function getRenderedPointMatch(target) {
  const pointLayerId = getPointLayerIdForSource(target.sourceKey);
  if (!map.getLayer(pointLayerId)) return null;

  const rendered = map.queryRenderedFeatures({ layers: [pointLayerId] });

  for (const feature of rendered) {
    if (!feature.geometry || feature.geometry.type !== 'Point') continue;

    const [lon, lat] = feature.geometry.coordinates;
    if (areSameCoordinates(lon, lat, target.lon, target.lat)) {
      return {
        lon,
        lat,
        size: Number(feature.properties?.size) || target.size || 1
      };
    }
  }

  return null;
}

function clusterContainsTarget(source, clusterId, target) {
  return new Promise((resolve) => {
    source.getClusterLeaves(clusterId, 1000, 0, (err, leaves) => {
      if (err || !Array.isArray(leaves)) {
        resolve(false);
        return;
      }

      const found = leaves.some((leaf) => {
        if (!leaf.geometry || leaf.geometry.type !== 'Point') return false;
        const [lon, lat] = leaf.geometry.coordinates;
        return areSameCoordinates(lon, lat, target.lon, target.lat);
      });

      resolve(found);
    });
  });
}

async function getRenderedClusterMatch(target) {
  const clusterLayerId = getClusterLayerIdForSource(target.sourceKey);
  const source = map.getSource(target.sourceKey);

  if (!map.getLayer(clusterLayerId) || !source) return null;

  const renderedClusters = map.queryRenderedFeatures({ layers: [clusterLayerId] });

  for (const feature of renderedClusters) {
    const clusterId = feature.properties?.cluster_id;
    if (clusterId === undefined || clusterId === null) continue;

    const containsTarget = await clusterContainsTarget(source, clusterId, target);
    if (!containsTarget) continue;

    if (!feature.geometry || feature.geometry.type !== 'Point') continue;

    const [lon, lat] = feature.geometry.coordinates;

    return {
      lon,
      lat,
      size: Number(feature.properties?.maxSize) || target.size || 1
    };
  }

  return null;
}

async function showBestCrosshairForTarget(target) {
  if (!target || !target.sourceKey) return;

  const requestToken = ++crosshairRequestToken;

  const renderedPoint = getRenderedPointMatch(target);
  if (requestToken !== crosshairRequestToken) return;
  if (renderedPoint) {
    renderCrosshair(renderedPoint.lon, renderedPoint.lat, renderedPoint.size);
    return;
  }

  const renderedCluster = await getRenderedClusterMatch(target);
  if (requestToken !== crosshairRequestToken) return;
  if (renderedCluster) {
    renderCrosshair(renderedCluster.lon, renderedCluster.lat, renderedCluster.size);
    return;
  }

  renderCrosshair(target.lon, target.lat, target.size || 1);
}

function buildTargetFromFeature(feature, sourceKey) {
  if (!feature?.geometry || feature.geometry.type !== 'Point') return null;

  const [lon, lat] = feature.geometry.coordinates;
  return {
    lon: Number(lon),
    lat: Number(lat),
    size: Number(feature.properties?.size) || 1,
    sourceKey
  };
}

function buildTargetFromActiveCard() {
  const overlay = document.querySelector('.panel-card.is-active .image-overlay');
  if (!overlay) return null;

  const lon = parseFloat(overlay.dataset.lon);
  const lat = parseFloat(overlay.dataset.lat);
  const size = parseFloat(overlay.dataset.size || '1');
  const sourceKey = overlay.dataset.sourceKey;

  if (isNaN(lon) || isNaN(lat) || !sourceKey) return null;

  return {
    lon,
    lat,
    size: Number(size) || 1,
    sourceKey
  };
}

/* ========= GEOCODER (solo una volta) ========= */
function setupGeocoderOnce() {
  const searchContainer = document.getElementById('search-container');

  if (
    searchContainer &&
    typeof MapboxGeocoder !== 'undefined' &&
    !searchContainer.querySelector('.mapboxgl-ctrl-geocoder')
  ) {
    function dmsToDecimal(deg, min, sec, hemi) {
      const d = Math.abs(Number(deg)) + (Number(min) || 0) / 60 + (Number(sec) || 0) / 3600;
      const sign = (hemi === 'S' || hemi === 'W') ? -1 : 1;
      return sign * d;
    }

    function formatCoordPair(lat, lon) {
      const latStr = Number(lat).toFixed(5);
      const lonStr = Number(lon).toFixed(5);
      return `${latStr}, ${lonStr}`;
    }

    function parseCoordQuery(raw) {
      const q = raw.trim().toUpperCase();

      const dmsRe = /([NSWE])?\s*(\d{1,3})\s*°\s*(\d{1,2})?\s*'?\s*(\d{1,2}(?:\.\d+)?)?\s*"?\s*([NSWE])?/g;
      const dmsParts = [];
      let m;

      while ((m = dmsRe.exec(q)) !== null) {
        const hemi = (m[1] || m[5] || '').trim();
        if (!hemi) continue;

        dmsParts.push({
          hemi,
          deg: m[2],
          min: m[3] || 0,
          sec: m[4] || 0
        });

        if (dmsParts.length === 2) break;
      }

      if (dmsParts.length === 2) {
        const a = dmsToDecimal(dmsParts[0].deg, dmsParts[0].min, dmsParts[0].sec, dmsParts[0].hemi);
        const b = dmsToDecimal(dmsParts[1].deg, dmsParts[1].min, dmsParts[1].sec, dmsParts[1].hemi);

        let lat = null;
        let lon = null;

        [a, b].forEach((val, i) => {
          const hemi = dmsParts[i].hemi;
          if (hemi === 'N' || hemi === 'S') lat = val;
          if (hemi === 'E' || hemi === 'W') lon = val;
        });

        if (lat !== null && lon !== null) return { lat, lon };
      }

      const simple = q.match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
      if (simple) {
        const a = parseFloat(simple[1]);
        const b = parseFloat(simple[2]);

        const isLat = (x) => x >= -90 && x <= 90;
        const isLon = (x) => x >= -180 && x <= 180;

        if (isLat(a) && isLon(b)) return { lat: a, lon: b };
        if (isLon(a) && isLat(b)) return { lat: b, lon: a };

        return null;
      }

      const tokenRe = /([NSWE])?\s*(-?\d+(?:\.\d+)?)\s*([NSWE])?/g;
      const tokens = [];
      let t;

      while ((t = tokenRe.exec(q)) !== null) {
        const hemi = (t[1] || t[3] || '').trim();
        const num = parseFloat(t[2]);
        if (!Number.isFinite(num) || !hemi) continue;

        tokens.push({ hemi, num });
        if (tokens.length === 2) break;
      }

      if (tokens.length === 2) {
        let lat = null;
        let lon = null;

        for (const tok of tokens) {
          if (tok.hemi === 'N' || tok.hemi === 'S') {
            lat = tok.hemi === 'S' ? -Math.abs(tok.num) : Math.abs(tok.num);
          }
          if (tok.hemi === 'E' || tok.hemi === 'W') {
            lon = tok.hemi === 'W' ? -Math.abs(tok.num) : Math.abs(tok.num);
          }
        }

        if (lat !== null && lon !== null) return { lat, lon };
      }

      return null;
    }

    const geocoder = new MapboxGeocoder({
      accessToken: mapboxgl.accessToken,
      mapboxgl,
      marker: false,
      flyTo: { speed: 1.2 },
      language: 'en',
      placeholder: 'Search for a place',

      localGeocoder: (query) => {
        const parsed = parseCoordQuery(query);
        if (!parsed) return null;

        const { lat, lon } = parsed;
        const label = formatCoordPair(lat, lon);

        return [{
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [lon, lat]
          },
          place_name: label,
          text: label,
          center: [lon, lat],
          place_type: ['coordinate'],
          properties: {
            kind: 'coords'
          }
        }];
      },

      render: (item) => {
        if (item.properties && item.properties.kind === 'coords') {
          return `<div class="custom-coord-suggestion">${item.place_name}</div>`;
        }

        return `<div>${item.place_name}</div>`;
      }
    });

    searchContainer.appendChild(geocoder.onAdd(map));

    const input = searchContainer.querySelector('.mapboxgl-ctrl-geocoder--input');

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;

        const query = input.value.trim();
        const match = query.match(/^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/);
        if (!match) return;

        const a = parseFloat(match[1]);
        const b = parseFloat(match[3]);

        const isLat = (x) => x >= -90 && x <= 90;
        const isLon = (x) => x >= -180 && x <= 180;

        let coords = null;

        if (isLat(a) && isLon(b)) coords = [b, a];
        else if (isLon(a) && isLat(b)) coords = [a, b];

        if (coords) {
          e.preventDefault();

          map.flyTo({
            center: coords,
            zoom: 12,
            speed: 1.2
          });
        }
      });
    }
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

  layers.forEach((id) => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  });
}

function applyLayerToggleState() {
  document.querySelectorAll('.layer-toggle').forEach((toggle) => {
    const layerKey = toggle.dataset.layer;
    const visible = toggle.classList.contains('active');
    setLayerGroupVisibility(layerKey, visible);
  });
}

/* ========= INIT ========= */
function initDataLayersAndHandlers() {
  addSourcesIfMissing();
  addLayersIfMissing();
  applyLayerToggleState();
  bindMapInteractions();
  updatePanelHeight();
  refreshCrosshair();
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

  if (!map.getSource('hover-crosshair')) {
    map.addSource('hover-crosshair', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: []
      }
    });
  }
}

function addLayersIfMissing() {
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

  if (!map.getLayer('hover-crosshair-lines')) {
    map.addLayer({
      id: 'hover-crosshair-lines',
      type: 'line',
      source: 'hover-crosshair',
      layout: {
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#000000',
        'line-width': ['coalesce', ['get', 'strokeWidth'], 3]
      }
    });
  }
}

/* ========= HANDLERS MAP ========= */
function bindMapInteractions() {
  map.off('click', 'clusters-nero', onClickClusterNero);
  map.on('click', 'clusters-nero', onClickClusterNero);

  map.off('click', 'clusters-bianco', onClickClusterBianco);
  map.on('click', 'clusters-bianco', onClickClusterBianco);

  const layers = ['clusters-nero', 'clusters-bianco', 'nero-points', 'unclustered-point-bianco'];
  layers.forEach((layer) => {
    map.off('mouseenter', layer, onEnterPointer);
    map.off('mouseleave', layer, onLeavePointer);
    map.on('mouseenter', layer, onEnterPointer);
    map.on('mouseleave', layer, onLeavePointer);
  });

  map.off('click', 'nero-points', onClickNeroPoint);
  map.off('click', 'unclustered-point-bianco', onClickBiancoPoint);
  map.on('click', 'nero-points', onClickNeroPoint);
  map.on('click', 'unclustered-point-bianco', onClickBiancoPoint);

  map.off('move', refreshCrosshair);
  map.off('zoom', refreshCrosshair);
  map.on('move', refreshCrosshair);
  map.on('zoom', refreshCrosshair);
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

function onEnterPointer(e) {
  map.getCanvas().style.cursor = 'pointer';

  const feature = e?.features?.[0];
  if (!feature) return;

  const layerId = e?.features?.[0]?.layer?.id || '';

  if (layerId === 'nero-points') {
    const target = buildTargetFromFeature(feature, 'nero');
    if (target) showBestCrosshairForTarget(target);
    return;
  }

  if (layerId === 'unclustered-point-bianco') {
    const target = buildTargetFromFeature(feature, 'bianco');
    if (target) showBestCrosshairForTarget(target);
    return;
  }

  hideCrosshair();
}

function onLeavePointer() {
  map.getCanvas().style.cursor = '';
  hideCrosshair();
}

function onClickNeroPoint(e) {
  updatePanel(e.features[0], 'nero');
}

function onClickBiancoPoint(e) {
  updatePanel(e.features[0], 'bianco');
}

/* ========= RANDOM IMAGE ========= */
async function loadGeoJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

function isSize2Feature(f) {
  const size = f?.properties?.size;
  return Number(size) === 2 && f?.geometry?.type === 'Point';
}

async function pickRandomSize2FromBothLayers() {
  const [nero, bianco] = await Promise.all([
    loadGeoJSON('nero.geojson').catch(() => null),
    loadGeoJSON('bianco.geojson').catch(() => null)
  ]);

  const neroCandidates = (nero?.features || [])
    .filter(isSize2Feature)
    .map((f) => ({
      ...f,
      properties: {
        ...(f.properties || {}),
        __sourceKey: 'nero'
      }
    }));

  const biancoCandidates = (bianco?.features || [])
    .filter(isSize2Feature)
    .map((f) => ({
      ...f,
      properties: {
        ...(f.properties || {}),
        __sourceKey: 'bianco'
      }
    }));

  const candidates = [...neroCandidates, ...biancoCandidates];
  if (!candidates.length) return null;

  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx];
}

async function showRandomSize2OnStartup() {
  if (startupRandomShown) return;
  startupRandomShown = true;

  try {
    const f = await pickRandomSize2FromBothLayers();
    if (f) updatePanel(f, f.properties?.__sourceKey || null);
  } catch (e) {
    console.warn('Startup random size=2 failed:', e);
  }
}

async function refreshRandomSize2() {
  try {
    const f = await pickRandomSize2FromBothLayers();
    if (f) updatePanel(f, f.properties?.__sourceKey || null);
  } catch (e) {
    console.warn('Random refresh failed:', e);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  showRandomSize2OnStartup();
});

/* ========= PANEL ========= */
function updatePanel(feature, sourceKey = null) {
  const properties = feature.properties || {};

  let coordsText = '';
  let lon = null;
  let lat = null;

  if (
    feature.geometry &&
    feature.geometry.type === 'Point' &&
    Array.isArray(feature.geometry.coordinates)
  ) {
    [lon, lat] = feature.geometry.coordinates;
    coordsText = formatCoords(Number(lat), Number(lon));
  }

  const coordsTextEl = document.querySelector('.panel-card.is-active .coords-text');
  if (coordsTextEl) coordsTextEl.textContent = coordsText;

  const overlay = document.querySelector('.panel-card.is-active .image-overlay');

  if (overlay && lon !== null && lat !== null) {
    overlay.dataset.lon = lon;
    overlay.dataset.lat = lat;
    overlay.dataset.size = Number(properties.size) || 1;
    overlay.dataset.sourceKey = sourceKey || properties.__sourceKey || '';
  }

  const title =
    (properties.name && properties.name.trim()) ||
    (properties.title && properties.title.trim()) ||
    'Senza nome';

  const titleTextEl = document.querySelector('.panel-card.is-active .title-text');
  if (titleTextEl) titleTextEl.textContent = title;

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

  let imageUrl = null;

  const imgMatch = htmlContent.match(/<img[^>]+src="([^">]+)"/);
  if (imgMatch && imgMatch[1]) {
    imageUrl = imgMatch[1];
  } else if (properties.gx_media_links) {
    imageUrl = properties.gx_media_links;
  }

  const imgEl = document.querySelector('.panel-card.is-active .panel-image');

  if (imgEl && imageUrl) {
    const proxiedUrl =
      'https://pingeo-image-proxy.danielecinquini1.workers.dev/image?url=' +
      encodeURIComponent(imageUrl);

    console.log('PROXY IMG →', proxiedUrl);

    preloadImage(proxiedUrl, (loadedUrl) => {
      if (loadedUrl) {
        imgEl.src = loadedUrl;
        imgEl.style.display = 'block';

        const panel = document.getElementById('panel');
        if (panel) panel.style.opacity = 1;
      }
    });
  } else if (imgEl) {
    imgEl.style.display = 'none';
  }

  const country = (properties.country && properties.country.trim()) || '';
  const overlayDescEl = document.querySelector('.panel-card.is-active .overlay-description');
  if (overlayDescEl) overlayDescEl.textContent = country;

  updatePanelScale();
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
document.getElementById('panel')?.addEventListener('click', (e) => {
  const card = e.target.closest('.panel-card');
  if (!card) return;

  if (e.target.closest('.coords-copy')) {
    e.stopPropagation();
    const text = card.querySelector('.coords-text')?.textContent;
    if (text) navigator.clipboard.writeText(text);
    return;
  }

  if (e.target.closest('.title-copy')) {
    e.stopPropagation();
    const text = card.querySelector('.title-text')?.textContent;
    if (text) navigator.clipboard.writeText(text);
    return;
  }
});

/* ========= OVERLAY CLICK -> INCREMENTAL FLYTO ========= */
document.getElementById('panel')?.addEventListener('click', (e) => {
  const overlay = e.target.closest('.image-overlay');
  if (!overlay) return;

  if (e.target.closest('button')) return;

  const lon = parseFloat(overlay.dataset.lon);
  const lat = parseFloat(overlay.dataset.lat);

  if (!isNaN(lon) && !isNaN(lat)) {
    const currentZoom = map.getZoom();
    const nextZoom = Math.min(currentZoom + 2, 14);

    map.easeTo({
      center: [lon, lat],
      zoom: nextZoom,
      duration: 800
    });
  }
});

/* ========= CARD HOVER -> CROSSHAIR ========= */
document.getElementById('panel')?.addEventListener('mouseenter', (e) => {
  const overlay = e.target.closest('.panel-card.is-active .image-overlay');
  if (!overlay) return;

  const target = buildTargetFromActiveCard();
  if (target) showBestCrosshairForTarget(target);
}, true);

document.getElementById('panel')?.addEventListener('mouseleave', (e) => {
  const overlay = e.target.closest('.panel-card.is-active .image-overlay');
  if (!overlay) return;

  hideCrosshair();
}, true);

/* ========= TOOLTIP LAYER INFO ========= */
const layerInfo = document.getElementById('layer-info');
const toggles = document.querySelectorAll('.layer-toggle');

toggles.forEach((toggle) => {
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

/* ========= TOGGLE UI CLICK ========= */
document.querySelectorAll('.layer-toggle').forEach((toggle) => {
  const layerKey = toggle.dataset.layer;
  let active = true;

  toggle.classList.add('active');

  toggle.addEventListener('click', () => {
    active = !active;
    toggle.classList.toggle('active', active);
    setLayerGroupVisibility(layerKey, active);
  });
});

/* ========= LOAD ========= */
map.on('load', () => {
  console.log('Mapbox caricato correttamente');

  updatePanelScale();
  updatePanelHeight();

  map.addControl(new ZoomAndStyleControl(), 'top-right');
  map.addControl(new DualScaleControl(), 'top-left');

  setupGeocoderOnce();
  initDataLayersAndHandlers();
  lockZenithNorth();
});

/* ========= STYLE LOAD ========= */
map.on('style.load', () => {
  initDataLayersAndHandlers();
  lockZenithNorth();
});

window.addEventListener('resize', () => {
  updatePanelScale();
  updatePanelHeight();
  refreshCrosshair();
});

function lockZenithNorth() {
  try {
    map.setMinPitch(0);
    map.setMaxPitch(0);
  } catch (e) {}

  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();

  try {
    map.setPitch(0, { animate: false });
    map.setBearing(0, { animate: false });
  } catch (e) {}

  const snapBack = () => {
    const b = map.getBearing();
    const p = map.getPitch();

    if (Math.abs(b) > 0.001) map.setBearing(0, { animate: false });
    if (Math.abs(p) > 0.001) map.setPitch(0, { animate: false });
  };

  map.off('rotateend', snapBack);
  map.off('pitchend', snapBack);

  map.on('rotateend', snapBack);
  map.on('pitchend', snapBack);
}

/* ========= LOGO CLICK -> RANDOM CARD ========= */
document.getElementById('brand')?.addEventListener('click', () => {
  refreshRandomSize2();
});