mapboxgl.accessToken = window.MAPBOX_TOKEN;

/* ========= MAP ========= */
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/pingeo/cmle3qgj100br01s9fgb3gbo3',
  projection: 'globe',
  center: [9.2, 45.5],
  zoom: 6
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
let activeHoverTarget = null;
let crosshairIdlePending = false;
let selectedCrosshairTarget = null;
let adaptiveProjectionMode = 'globe';
let isProgrammaticMove = false;
let isClickInteraction = false;

const geojsonCache = {};
let geojsonPreloadPromise = null;

const superclusterIndex = {};

const clusterLeavesCache = {};

const clusterBestLeafCache = {};

/* ========= INTERACTION STATE ========= */
function activateHover(target) {
  setHoverCrosshairTarget(target);
  showBestCrosshairForTarget(target);
  setActiveCardOverlayForced(false);
}

function activateSelection(target) {
  setSelectedCrosshairTarget(target);
  showBestCrosshairForTarget(target);
  setActiveCardOverlayForced(true);
}

function activateSearchHighlight(target) {
  setSelectedCrosshairTarget(target);
  showBestCrosshairForTarget(target);
  setActiveCardOverlayForced(true);

  setupTransientHighlightClear();
}

function clearInteraction({ keepSelection = false } = {}) {
  if (keepSelection) return;

  selectedCrosshairTarget = null;
  activeHoverTarget = null;

  setActiveCardOverlayForced(false);
  hideCrosshair();
}

/* ========= STARTUP ========= */
window.addEventListener('DOMContentLoaded', () => {
  refreshPanelLayout();
  showStartupRandomSize2Card();
});

/* ========= PANEL HEIGHT / SCALE ========= */
function updatePanelHeight() {
  const strip = document.getElementById('panel-strip');
  if (strip) strip.style.opacity = 1;

  const panel = document.getElementById('panel');
  if (!panel) return;

  const height = panel.offsetHeight;
  document.documentElement.style.setProperty('--panel-height', `${height}px`);

  requestAnimationFrame(() => {
    map.resize();
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

function refreshPanelLayout() {
  updatePanelScale();
  updatePanelHeight();
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

function setupMapInteractionClear() {
  const clear = () => {
    if (isProgrammaticMove) return;
    clearInteraction();
  };

  map.on('movestart', clear);
}

function setupUserInputClear() {
  const clear = () => {
    if (isClickInteraction) return;
    clearInteraction();
  };

  // 🖱️ mouse wheel (zoom)
  map.getCanvas().addEventListener('wheel', clear, { passive: true });

  // ✋ touch pan
  map.getCanvas().addEventListener('touchstart', clear, { passive: true });

  // 🖱️ drag mouse
  map.on('dragstart', clear);

  // 🔍 pinch zoom
  map.on('zoomstart', clear);
}

function renderHtmlCrosshair(
  lon,
  lat,
  sizeValue
) {
  const pointSizeMap = {
    1: 22,
    2: 30,
    3: 38
  };

  const clusterSizeMap = {
    1: 32,
    2: 40,
    3: 48
  };

  const isCluster =
    activeCrosshair?.isCluster ===
    true;

  const sizeMap =
    isCluster
      ? clusterSizeMap
      : pointSizeMap;

  const diameter =
    sizeMap[
      Number(sizeValue)
    ] || 30;

  showMapboxCrosshairRing({
    lon,
    lat,
    diameter
  });
}

function hideHtmlCrosshair() {
  hideMapboxCrosshairRing();
}

function refreshHtmlCrosshair() {
  if (!activeCrosshair)
    return;

  renderHtmlCrosshair(
    activeCrosshair.lon,
    activeCrosshair.lat,
    activeCrosshair.size
  );
}

function renderCrosshair(
  lon,
  lat,
  sizeValue,
  isCluster = false
) {
  activeCrosshair = {
    lon: Number(lon),
    lat: Number(lat),
    size: Number(sizeValue) || 1,
    isCluster
  };

  renderHtmlCrosshair(
    activeCrosshair.lon,
    activeCrosshair.lat,
    activeCrosshair.size
  );

  const target =
    getCurrentCrosshairTarget();

  if (target) {
    showCrosshairHighlight({
      lon:
        activeCrosshair.lon,

      lat:
        activeCrosshair.lat,

      size:
        activeCrosshair.size,

      sourceKey:
        target.sourceKey,

      isCluster:
        activeCrosshair.isCluster
    });
  }
}

function hideCrosshair() {
  activeCrosshair = null;
  activeHoverTarget = null;
  crosshairRequestToken += 1;
  hideHtmlCrosshair();
  hideCrosshairHighlight();
  syncAdaptiveProjection();
}

function hideCrosshairKeepTarget() {
  activeCrosshair = null;
  crosshairRequestToken += 1;
  hideHtmlCrosshair();
  hideCrosshairHighlight();
}

function clearAllCrosshairState() {
  if (!selectedCrosshairTarget) {
    activeCrosshair = null;
    activeHoverTarget = null;
    crosshairRequestToken += 1;
    hideHtmlCrosshair();

    setActiveCardOverlayForced(false);
  }
}

function refreshCrosshair() {
  refreshHtmlCrosshair();
}

function refreshBestCrosshairAfterMove() {
  if (!getCurrentCrosshairTarget()) return;
  if (crosshairIdlePending) return;

  crosshairIdlePending = true;

  map.once('idle', () => {
    requestAnimationFrame(() => {
      crosshairIdlePending = false;
      refreshCurrentCrosshairTarget();
    });
  });
}

function areSameCoordinates(aLon, aLat, bLon, bLat, tolerance = 1e-5) {
  return (
    Math.abs(Number(aLon) - Number(bLon)) <= tolerance &&
    Math.abs(Number(aLat) - Number(bLat)) <= tolerance
  );
}

function getPointLayerIdForSource(sourceKey) {
  return `${sourceKey}-points`;
}

function getClusterLayerIdForSource(sourceKey) {
  return `${sourceKey}-clusters`;
}

function getClusterRingLayerIdForSource(sourceKey) {
  return `${sourceKey}-clusters-ring`;
}

function getLayerIdsForSource(sourceKey) {
  return [
    getClusterLayerIdForSource(sourceKey),
    getClusterRingLayerIdForSource(sourceKey),
    getPointLayerIdForSource(sourceKey)
  ];
}

function getRenderedPointMatch(target) {
  const pointLayerId = getPointLayerIdForSource(target.sourceKey);
  if (!map.getLayer(pointLayerId)) return null;

  const rendered = map.queryRenderedFeatures({ layers: [pointLayerId] });
  const targetIdentity = {
    name: target.name || '',
    country: target.country || '',
    size: Number(target.size) || 1,
    mediaLink: target.mediaLink || '',
    description: target.description || ''
  };

  for (const feature of rendered) {
    if (!feature?.geometry || feature.geometry.type !== 'Point') continue;

    const featureIdentity = getFeatureIdentity(feature);
    if (!isSameFeatureIdentity(featureIdentity, targetIdentity)) continue;

    const [lon, lat] = feature.geometry.coordinates;
    return {
      lon,
      lat,
      size: featureIdentity.size || target.size || 1
    };
  }

  const rawLon = Number(target.rawLon ?? target.lon);
  const rawLat = Number(target.rawLat ?? target.lat);

  for (const feature of rendered) {
    if (!feature?.geometry || feature.geometry.type !== 'Point') continue;

    const [lon, lat] = feature.geometry.coordinates;
    if (
      Math.abs(Number(lon) - rawLon) <= 1e-5 &&
      Math.abs(Number(lat) - rawLat) <= 1e-5
    ) {
      return {
        lon,
        lat,
        size: Number(feature.properties?.size) || target.size || 1
      };
    }
  }

  return null;
}

function getNearestRenderedFeatureForTarget(target, maxPixelDistance = 80) {
  if (!target?.sourceKey) return null;

  const pointLayerId = getPointLayerIdForSource(target.sourceKey);
  const clusterLayerId = getClusterLayerIdForSource(target.sourceKey);

  const layers = [];
  if (map.getLayer(pointLayerId)) layers.push(pointLayerId);
  if (map.getLayer(clusterLayerId)) layers.push(clusterLayerId);

  if (!layers.length) return null;

  const rendered = map.queryRenderedFeatures({ layers });
  if (!rendered.length) return null;

  const targetLon = Number(target.lon);
  const targetLat = Number(target.lat);
  const targetPixel = map.project([targetLon, targetLat]);

  let best = null;
  let bestDistSq = Infinity;

  for (const feature of rendered) {
    if (!feature?.geometry || feature.geometry.type !== 'Point') continue;

    const [lon, lat] = feature.geometry.coordinates;
    const pixel = map.project([lon, lat]);

    const dx = pixel.x - targetPixel.x;
    const dy = pixel.y - targetPixel.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = {
        lon,
        lat,
        size: Number(feature.properties?.maxSize ?? feature.properties?.size) || target.size || 1,
        isCluster: Boolean(feature.properties?.cluster)
      };
    }
  }

  if (!best) return null;

  const maxDistSq = maxPixelDistance * maxPixelDistance;
  if (bestDistSq > maxDistSq) return null;

  return best;
}

function getRenderedClusterContainingTarget(target) {
  if (!target?.sourceKey) return null;

  const clusterLayerId =
    getClusterLayerIdForSource(target.sourceKey);

  if (!map.getLayer(clusterLayerId)) {
    return null;
  }

  const renderedClusters =
    map.queryRenderedFeatures({
      layers: [clusterLayerId]
    });

  if (!renderedClusters.length) {
    return null;
  }

  const targetIdentity = {
    name: target.name || '',
    country: target.country || '',
    size: Number(target.size) || 1,
    mediaLink: target.mediaLink || '',
    description: target.description || ''
  };

  for (const cluster of renderedClusters) {
    const clusterId =
      cluster.properties?.cluster_id;

    if (clusterId == null) continue;

    const leaves =
      getClusterLeaves(
        target.sourceKey,
        clusterId
      );

    const containsTarget =
      leaves.some((leaf) => {
        const leafIdentity =
          getFeatureIdentity(leaf);

        return isSameFeatureIdentity(
          leafIdentity,
          targetIdentity
        );
      });

    if (!containsTarget) {
      continue;
    }

    const coords =
      cluster.geometry?.coordinates;

    if (!coords) {
      continue;
    }

    return {
      lon: coords[0],
      lat: coords[1],
      size:
        Number(
          cluster.properties?.maxSize
        ) || 1
    };
  }

  return null;
}

function showBestCrosshairForTarget(target) {
  const normalizedTarget =
    normalizeCrosshairTarget(target);

  if (!normalizedTarget) return;

  setHoverCrosshairTarget(
    normalizedTarget
  );

  syncAdaptiveProjection();
  hideCrosshairKeepTarget();

  const requestToken =
    ++crosshairRequestToken;

  requestAnimationFrame(
    async () => {
      if (
        requestToken !==
        crosshairRequestToken
      ) {
        return;
      }

      // 🔹 1. point renderizzato
      const pointMatch =
        getRenderedPointMatch(
          normalizedTarget
        );

      if (pointMatch) {
        if (
          requestToken !==
          crosshairRequestToken
        ) {
          return;
        }

        renderCrosshair(
          pointMatch.lon,
          pointMatch.lat,
          pointMatch.size,
          false
        );

        return;
      }

      // 🔹 2. cluster che contiene il target
      const clusterMatch =
        getRenderedClusterContainingTarget(
          normalizedTarget
        );

      if (clusterMatch) {
        if (
          requestToken !==
          crosshairRequestToken
        ) {
          return;
        }

        renderCrosshair(
          clusterMatch.lon,
          clusterMatch.lat,
          clusterMatch.size,
          true
        );

        return;
      }

      // 🔹 3. fallback nearest
      const fallbackMatch =
        getNearestRenderedFeatureForTarget(
          normalizedTarget,
          80
        );

      if (fallbackMatch) {
        if (
          requestToken !==
          crosshairRequestToken
        ) {
          return;
        }

        renderCrosshair(
          fallbackMatch.lon,
          fallbackMatch.lat,
          fallbackMatch.size,
          Boolean(
            fallbackMatch.isCluster
          )
        );

        return;
      }

      if (
        requestToken !==
        crosshairRequestToken
      ) {
        return;
      }

      hideCrosshairKeepTarget();
    }
  );
}

function buildTargetFromFeature(feature, sourceKey) {
  const normalizedFeature = normalizeFeature(feature, sourceKey);
  const { coords, identity } = normalizedFeature;

  return createCrosshairTarget({
    lon: coords.visualLon,
    lat: coords.visualLat,
    rawLon: coords.rawLon,
    rawLat: coords.rawLat,
    sourceKey: normalizedFeature.sourceKey,
    identity
  });
}

function buildTargetFromActiveCard() {
  const overlay = document.querySelector('.panel-card.is-active .image-overlay');
  if (!overlay) return null;

  const lon = parseFloat(overlay.dataset.lon);
  const lat = parseFloat(overlay.dataset.lat);
  const rawLon = parseFloat(overlay.dataset.rawLon);
  const rawLat = parseFloat(overlay.dataset.rawLat);
  const sourceKey = overlay.dataset.sourceKey;
  const identity = getFeatureIdentityFromDataset(overlay.dataset);

  return createCrosshairTarget({
    lon,
    lat,
    rawLon: !isNaN(rawLon) ? rawLon : lon,
    rawLat: !isNaN(rawLat) ? rawLat : lat,
    sourceKey,
    identity
  });
}

function setActiveCardOverlayForced(force) {
  const overlay = document.querySelector('.panel-card.is-active .image-overlay');
  if (!overlay) return;

  overlay.classList.toggle('is-forced', Boolean(force));
}

function isNormalizedFeatureSameAsActiveCard(normalizedFeature) {
  const overlay = document.querySelector('.panel-card.is-active .image-overlay');
  if (!overlay || !normalizedFeature) return false;

  const activeSourceKey = overlay.dataset.sourceKey || '';
  if (activeSourceKey !== (normalizedFeature.sourceKey || '')) return false;

  const activeIdentity = getFeatureIdentityFromDataset(overlay.dataset);
  const featureIdentity = normalizedFeature.identity;

  if (isSameFeatureIdentity(activeIdentity, featureIdentity)) {
    return true;
  }

  const activeRawLon = Number(overlay.dataset.rawLon ?? overlay.dataset.lon);
  const activeRawLat = Number(overlay.dataset.rawLat ?? overlay.dataset.lat);
  const featureRawLon = Number(normalizedFeature.coords.rawLon ?? normalizedFeature.coords.visualLon);
  const featureRawLat = Number(normalizedFeature.coords.rawLat ?? normalizedFeature.coords.visualLat);

  return areSameCoordinates(activeRawLon, activeRawLat, featureRawLon, featureRawLat);
}

function syncActiveCardOverlayWithFeature(feature, sourceKey) {
  if (!feature || !sourceKey) {
    setActiveCardOverlayForced(false);
    return;
  }

  const normalizedFeature = normalizeFeature(feature, sourceKey);
  setActiveCardOverlayForced(isNormalizedFeatureSameAsActiveCard(normalizedFeature));
}

function getCurrentCrosshairTarget() {
  return selectedCrosshairTarget || activeHoverTarget;
}

function refreshCurrentCrosshairTarget() {
  const target = getCurrentCrosshairTarget();
  if (!target) return;

  showBestCrosshairForTarget(target);
}

function normalizeCrosshairTarget(target) {
  if (!target || !target.sourceKey) return null;

  return {
    ...target,
    lon: Number(target.lon),
    lat: Number(target.lat),
    rawLon: target.rawLon != null ? Number(target.rawLon) : undefined,
    rawLat: target.rawLat != null ? Number(target.rawLat) : undefined,
    size: Number(target.size) || 1,
    sourceKey: target.sourceKey
  };
}

function setHoverCrosshairTarget(target) {
  activeHoverTarget = normalizeCrosshairTarget(target);
}

function setSelectedCrosshairTarget(target) {
  selectedCrosshairTarget = normalizeCrosshairTarget(target);
}

function getProjectionNameSafe() {
  try {
    const p = map.getProjection?.();
    if (!p) return null;
    if (typeof p === 'string') return p;
    return p.name || null;
  } catch (e) {
    return null;
  }
}

function applyProjectionMode(mode) {
  const currentProjection = getProjectionNameSafe();
  adaptiveProjectionMode = mode;

  if (currentProjection === mode) return;
  map.setProjection(mode);
}

function syncAdaptiveProjection() {
  const zoom = map.getZoom();

  const ENTER_MERCATOR_ZOOM = 5.25;
  const EXIT_MERCATOR_ZOOM = 4.9;

  let desiredMode = adaptiveProjectionMode;

  if (adaptiveProjectionMode === 'globe' && zoom >= ENTER_MERCATOR_ZOOM) {
    desiredMode = 'mercator';
  } else if (adaptiveProjectionMode === 'mercator' && zoom <= EXIT_MERCATOR_ZOOM) {
    desiredMode = 'globe';
  }

  if (desiredMode === adaptiveProjectionMode) return;
  applyProjectionMode(desiredMode);
}

function initializeAdaptiveProjection(defaultMode = 'globe') {
  adaptiveProjectionMode = getProjectionNameSafe() || defaultMode;
  syncAdaptiveProjection();
}

/* ========= GEOCODER (solo una volta) ========= */
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

function getCoordsFromSimplePair(a, b) {
  const isLat = (x) => x >= -90 && x <= 90;
  const isLon = (x) => x >= -180 && x <= 180;

  if (isLat(a) && isLon(b)) return { lat: a, lon: b };
  if (isLon(a) && isLat(b)) return { lat: b, lon: a };

  return null;
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

  const compactDms = q.match(
    /^([NS])\s*(\d{1,3})(?:\s+(\d{1,2}))?(?:\s+(\d{1,2}(?:\.\d+)?))?\s+([EW])\s*(\d{1,3})(?:\s+(\d{1,2}))?(?:\s+(\d{1,2}(?:\.\d+)?))$/
  );

  if (compactDms) {
    const lat = dmsToDecimal(
      compactDms[2],
      compactDms[3] || 0,
      compactDms[4] || 0,
      compactDms[1]
    );

    const lon = dmsToDecimal(
      compactDms[6],
      compactDms[7] || 0,
      compactDms[8] || 0,
      compactDms[5]
    );

    return { lat, lon };
  }

  const simple = q.match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
  if (simple) {
    const a = parseFloat(simple[1]);
    const b = parseFloat(simple[2]);
    return getCoordsFromSimplePair(a, b);
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

function setupGeocoderOnce() {
  const searchContainer =
    document.getElementById(
      'search-container'
    );

  if (
    !searchContainer ||
    typeof MapboxGeocoder ===
      'undefined' ||
    searchContainer.querySelector(
      '.mapboxgl-ctrl-geocoder'
    )
  ) {
    return;
  }

  const geocoder =
    new MapboxGeocoder({
      accessToken:
        mapboxgl.accessToken,

      mapboxgl,
      marker: false,
      flyTo: false,

      language: 'en',

      types:
        'place,locality,region',

      placeholder:
        'Search for a place',

      localGeocoderOnly: false,

      localGeocoder: (query) => {
        const results = [];

        if (
          !query ||
          query.length < 2
        ) {
          return results;
        }

        const q =
          query.toLowerCase();

        // 🔹 1. coordinate
        const parsed =
          parseCoordQuery(query);

        if (parsed) {
          const { lat, lon } =
            parsed;

          const label =
            formatCoordPair(
              lat,
              lon
            );

          results.push({
            type: 'Feature',

            geometry: {
              type: 'Point',
              coordinates: [
                lon,
                lat
              ]
            },

            place_name: label,
            text: label,
            center: [lon, lat],

            place_type: [
              'coordinate'
            ],

            properties: {
              kind: 'coords'
            }
          });
        }

        // 🔹 2. ricerca nei tuoi pin
        sourceKeys.forEach(
          (sourceKey) => {
            const geojson =
              geojsonCache[
                getGeoJsonUrlForSource(
                  sourceKey
                )
              ];

            if (
              !geojson?.features
            ) {
              return;
            }

            geojson.features.forEach(
              (f) => {
                if (
                  f.geometry
                    ?.type !==
                  'Point'
                ) {
                  return;
                }

                const nameRaw =
                  f.properties
                    ?.name || '';

                const name =
                  nameRaw.toLowerCase();

                if (!name) {
                  return;
                }

                const coords =
                  f.geometry
                    .coordinates;

                if (
                  !coords ||
                  coords.length <
                    2
                ) {
                  return;
                }

                const lon =
                  coords[0];

                const lat =
                  coords[1];

                const feature = {
                  type:
                    'Feature',

                  geometry: {
                    type:
                      'Point',

                    coordinates:
                      [lon, lat]
                  },

                  center: [
                    lon,
                    lat
                  ],

                  place_name:
                    `${nameRaw} — ${
                      f.properties
                        ?.country ||
                      ''
                    }`,

                  text: nameRaw,

                  place_type: [
                    'pingeo'
                  ],

                  properties: {
                    kind:
                      'pingeo',

                    sourceKey,

                    original:
                      f
                  }
                };

                if (
                  name.startsWith(
                    q
                  )
                ) {
                  results.unshift(
                    feature
                  );
                } else if (
                  name.includes(
                    q
                  )
                ) {
                  results.push(
                    feature
                  );
                }
              }
            );
          }
        );

        return results;
      },

      render: (item) => {
        // 🔹 coordinate
        if (
          item.properties
            ?.kind ===
          'coords'
        ) {
          return `
            <div class="custom-coord-suggestion">
              ${item.place_name}
            </div>
          `;
        }

        // 🔹 pin geojson
        if (
          item.properties
            ?.kind ===
          'pingeo'
        ) {
          const sourceKey =
            item.properties
              ?.sourceKey ||
            'nero';

          const size =
            Number(
              item
                .properties
                ?.original
                ?.properties
                ?.size
            ) || 1;

          const country =
            item.properties
              ?.original
              ?.properties
              ?.country ||
            '';

          return `
            <div class="custom-search-result">

              <div class="search-result-marker">
               <span
                  class="
                    search-result-dot
                    layer-${sourceKey}
                    size-${size}
                  ">
                </span>
              </div>

              <div class="search-result-text">
                ${item.text}
                <span style="opacity:0.6">
                  — ${country}
                </span>
              </div>

            </div>
          `;
        }

        // 🔹 risultati Mapbox standard
        const name =
          item.text || '';

        const context =
          item.context
            ? item.context
                .map(
                  (c) => c.text
                )
                .join(', ')
            : '';

        return `
          <div>
            ${name}
            ${
              context
                ? `
              <span style="opacity:0.6">
                — ${context}
              </span>
            `
                : ''
            }
          </div>
        `;
      }
    });

  // 🔹 mount
  searchContainer.appendChild(
    geocoder.onAdd(map)
  );

  // 🔥 RESULT HANDLER
  geocoder.on(
    'result',
    async (e) => {
      const feature =
        e.result;

      if (!feature) {
        return;
      }

      const input =
        searchContainer.querySelector(
          '.mapboxgl-ctrl-geocoder--input'
        );

      if (input) {
        input.value = '';
      }

      const coords =
        feature.center;

      if (!coords) {
        return;
      }

      const [lon, lat] =
        coords;

      // ✅ CASO 1:
      // pin tuo
      if (
        feature.properties
          ?.kind ===
        'pingeo'
      ) {
        const sourceKey =
          feature.properties
            .sourceKey;

        const originalFeature =
          feature.properties
            .original;

        if (
          !sourceKey ||
          !originalFeature
        ) {
          return;
        }

        ensureLayerVisible(
          sourceKey
        );

        const canonicalFeature =
          await resolveCanonicalFeature(
            originalFeature,
            sourceKey
          );

        updatePanel(
          canonicalFeature,
          sourceKey
        );

        map.stop();

        isProgrammaticMove =
          true;

        map.easeTo({
          center:
            canonicalFeature
              .geometry
              .coordinates,

          zoom: 10,
          duration: 800,

          easing: (t) =>
            1 -
            Math.pow(
              1 - t,
              3
            )
        });

        const target =
          buildTargetFromFeature(
            canonicalFeature,
            sourceKey
          );

        activateSearchHighlight(
          target
        );

        return;
      }

      // ✅ CASO 2:
      // Mapbox → nearest
      map.stop();

      isProgrammaticMove =
        true;

      map.flyTo({
        center: [
          lon,
          lat
        ],

        zoom: 10,
        speed: 1.2
      });

      const nearest =
        findNearestGeojsonPoint(
          lon,
          lat
        );

      if (nearest) {
        const {
          feature:
            nearestFeature,
          sourceKey
        } = nearest;

        const canonicalFeature =
          await resolveCanonicalFeature(
            nearestFeature,
            sourceKey
          );

        updatePanel(
          canonicalFeature,
          sourceKey
        );
      }

      clearInteraction();
    }
  );

  // 🔹 Enter su coordinate
  const input =
    searchContainer.querySelector(
      '.mapboxgl-ctrl-geocoder--input'
    );

  if (!input) {
    return;
  }

  input.addEventListener(
    'keydown',
    (e) => {
      if (
        e.key !== 'Enter'
      ) {
        return;
      }

      const query =
        input.value.trim();

      const match =
        query.match(
          /^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/
        );

      if (!match) {
        return;
      }

      const a =
        parseFloat(
          match[1]
        );

      const b =
        parseFloat(
          match[3]
        );

      const coords =
        getCoordsFromSimplePair(
          a,
          b
        );

      if (!coords) {
        return;
      }

      e.preventDefault();

      map.flyTo({
        center: [
          coords.lon,
          coords.lat
        ],

        zoom: 12,
        speed: 1.2
      });

      clearInteraction();
    }
  );
}

/* ========= LAYER ID ========= */
const sourceKeys = ['nero', 'bianco'];

const pointLayerSourceMap = Object.fromEntries(
  sourceKeys.map((sourceKey) => [getPointLayerIdForSource(sourceKey), sourceKey])
);

const clusterLayerSourceMap = Object.fromEntries(
  sourceKeys.flatMap((sourceKey) => [
    [getClusterLayerIdForSource(sourceKey), sourceKey],
    [getClusterRingLayerIdForSource(sourceKey), sourceKey],
  ])
);

const layerGroups = Object.fromEntries(
  sourceKeys.map((sourceKey) => [sourceKey, getLayerIdsForSource(sourceKey)])
);

const CROSSHAIR_HIGHLIGHT_SOURCE =
  'crosshair-highlight';

const CROSSHAIR_RING_SOURCE =
  'crosshair-ring';

const sourceStyleConfig = {
  nero: {
    color: '#2d2d2d'
  },
  bianco: {
    color: '#ffffff'
  }
};

/* ========= TOGGLE LAYER ========= */
function setLayerGroupVisibility(group, visible) {
  const layers = layerGroups[group];
  if (!layers) return;

  layers.forEach((id) => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  });
}

function ensureLayerVisible(sourceKey) {
  const toggle = document.querySelector(`.layer-toggle[data-layer="${sourceKey}"]`);
  if (!toggle) return;

  if (!toggle.classList.contains('active')) {
    toggle.classList.add('active');
    setLayerGroupVisibility(sourceKey, true);
  }
}

function applyLayerToggleState() {
  document.querySelectorAll('.layer-toggle').forEach((toggle) => {
    const layerKey = toggle.dataset.layer;
    const visible = toggle.classList.contains('active');
    setLayerGroupVisibility(layerKey, visible);
  });
}

function setupTransientHighlightClear() {
  const clear = () => {
    setActiveCardOverlayForced(false);
    hideCrosshair();

    window.removeEventListener('mousemove', clear);
    window.removeEventListener('mousedown', clear);
    window.removeEventListener('touchstart', clear);
    map.off('movestart', clear);
    map.off('zoomstart', clear);
    map.off('wheel', clear);
  };

  // 👇 eventi desktop
  window.addEventListener('mousemove', clear, { once: true });
  window.addEventListener('mousedown', clear, { once: true });
  window.addEventListener('wheel', clear, { once: true });

  // 👇 touch
  window.addEventListener('touchstart', clear, { once: true });

  // 👇 interazioni mappa
  map.on('movestart', clear);
  map.on('zoomstart', clear);
}

/* ========= INIT ========= */
function initDataLayers() {
  addSourcesIfMissing();
  addLayersIfMissing();
  applyLayerToggleState();
  updatePanelHeight();
  refreshCrosshair();
}

function getGeoJsonUrlForSource(sourceKey) {
  return `${sourceKey}.geojson`;
}

function addSourcesIfMissing() {
  sourceKeys.forEach((sourceKey) => {
    if (map.getSource(sourceKey)) return;

    map.addSource(sourceKey, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: []
      }
    });
  });
}

function getPointRadiusExpression() {
  return ['match', ['get', 'size'],
    1, 6,
    2, 10,
    3, 14,
    6
  ];
}

function getClusterRadiusExpression() {
  return ['match', ['get', 'maxSize'],
    1, 6,
    2, 10,
    3, 14,
    6
  ];
}

function getClusterRingRadiusExpression() {
  return ['match', ['get', 'maxSize'],
    1, 11,
    2, 15,
    3, 19,
    11
  ];
}

function getPointPaint(color) {
  return {
    'circle-color': color,
    'circle-radius': getPointRadiusExpression(),
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#000000'
  };
}

function getClusterPaint(color) {
  return {
    'circle-color': color,
    'circle-radius': getClusterRadiusExpression(),
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#000000'
  };
}

function getClusterRingPaint() {
  return {
    'circle-color': 'rgba(0,0,0,0)',
    'circle-radius': getClusterRingRadiusExpression(),
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#000000',
    'circle-stroke-opacity': 0.8
  };
}

function getSourceColor(sourceKey) {
  return sourceStyleConfig[sourceKey]?.color || '#000000';
}

function addLayersForSource(sourceKey) {
  const color = getSourceColor(sourceKey);

  // 🔽 RING
  if (!map.getLayer(getClusterRingLayerIdForSource(sourceKey))) {
    map.addLayer({
      id: getClusterRingLayerIdForSource(sourceKey),
      type: 'circle',
      source: sourceKey,
      filter: ['has', 'point_count'],
      layout: {
        visibility: 'none'
      },
      paint: getClusterRingPaint()
    });
  }

  // 🔼 CLUSTER
  if (!map.getLayer(getClusterLayerIdForSource(sourceKey))) {
    map.addLayer({
      id: getClusterLayerIdForSource(sourceKey),
      type: 'circle',
      source: sourceKey,
      filter: ['has', 'point_count'],
      layout: {
        visibility: 'none'
      },
      paint: {
        ...getClusterPaint(color),
        'circle-opacity': 1.0
      }
    });
  }

  // 🔼 POINT (più sopra di tutto)
  if (!map.getLayer(getPointLayerIdForSource(sourceKey))) {
    map.addLayer({
      id: getPointLayerIdForSource(sourceKey),
      type: 'circle',
      source: sourceKey,
      filter: ['!', ['has', 'point_count']],
      layout: {
        visibility: 'none'
      },
      paint: getPointPaint(color)
    });
  }
}

function addLayersIfMissing() {
  sourceKeys.forEach((sourceKey) => {
    addLayersForSource(sourceKey);
  });
}

function ensureCrosshairHighlightLayers() {
  if (
    !map.getSource(
      CROSSHAIR_HIGHLIGHT_SOURCE
    )
  ) {
    map.addSource(
      CROSSHAIR_HIGHLIGHT_SOURCE,
      {
        type: 'geojson',
        data: {
          type:
            'FeatureCollection',
          features: []
        }
      }
    );
  }

  // ring cluster highlight
  if (
    !map.getLayer(
      'crosshair-highlight-ring'
    )
  ) {
    map.addLayer({
      id:
        'crosshair-highlight-ring',

      type: 'circle',

      source:
        CROSSHAIR_HIGHLIGHT_SOURCE,

      filter: [
        '==',
        ['get', 'isCluster'],
        true
      ],

      paint:
        getClusterRingPaint()
    });
  }

  // cluster / point highlight
  if (
    !map.getLayer(
      'crosshair-highlight'
    )
  ) {
    map.addLayer({
      id:
        'crosshair-highlight',

      type: 'circle',

      source:
        CROSSHAIR_HIGHLIGHT_SOURCE,

      paint: {
        'circle-color': [
          'get',
          'color'
        ],

        'circle-radius': [
          'match',
          ['get', 'size'],
          1, 6,
          2, 10,
          3, 14,
          6
        ],

        'circle-stroke-width':
          1.5,

        'circle-stroke-color':
          '#000000'
      }
    });
  }

  // 👇 sempre sopra tutto
  map.moveLayer(
    'crosshair-highlight-ring'
  );

  map.moveLayer(
    'crosshair-highlight'
  );
}

function ensureCrosshairRingLayer() {
  if (
    !map.getSource(
      CROSSHAIR_RING_SOURCE
    )
  ) {
    map.addSource(
      CROSSHAIR_RING_SOURCE,
      {
        type: 'geojson',
        data: {
          type:
            'FeatureCollection',
          features: []
        }
      }
    );
  }

  if (
    !map.getLayer(
      'crosshair-ring'
    )
  ) {
    map.addLayer({
      id:
        'crosshair-ring',

      type: 'circle',

      source:
        CROSSHAIR_RING_SOURCE,

      paint: {
        'circle-color':
          'rgba(0,0,0,0)',

        'circle-stroke-color':
          '#ffe600',

        'circle-stroke-width':
          4,

        'circle-radius': [
          '/',
          ['get', 'diameter'],
          2
        ]
      }
    });
  }

  // sopra tutto,
  // ma sotto il clone
  map.moveLayer(
    'crosshair-ring'
  );

  map.moveLayer(
    'crosshair-highlight-ring'
  );

  map.moveLayer(
    'crosshair-highlight'
  );
}

function showMapboxCrosshairRing({
  lon,
  lat,
  diameter
}) {
  const source =
    map.getSource(
      CROSSHAIR_RING_SOURCE
    );

  if (!source) return;

  source.setData({
    type:
      'FeatureCollection',

    features: [
      {
        type:
          'Feature',

        properties: {
          diameter
        },

        geometry: {
          type:
            'Point',

          coordinates: [
            lon,
            lat
          ]
        }
      }
    ]
  });
}

function hideMapboxCrosshairRing() {
  const source =
    map.getSource(
      CROSSHAIR_RING_SOURCE
    );

  if (!source) return;

  source.setData({
    type:
      'FeatureCollection',
    features: []
  });
}

function showCrosshairHighlight({
  lon,
  lat,
  size,
  sourceKey,
  isCluster = false
}) {
  const source =
    map.getSource(
      CROSSHAIR_HIGHLIGHT_SOURCE
    );

  if (!source) return;

  source.setData({
    type:
      'FeatureCollection',

    features: [
      {
        type:
          'Feature',

        properties: {
          size:
            Number(size) || 1,

          maxSize:
            Number(size) || 1,

          color:
            getSourceColor(
              sourceKey
            ),

          isCluster
        },

        geometry: {
          type:
            'Point',

          coordinates: [
            lon,
            lat
          ]
        }
      }
    ]
  });
}

function hideCrosshairHighlight() {
  const source =
    map.getSource(
      CROSSHAIR_HIGHLIGHT_SOURCE
    );

  if (!source) return;

  source.setData({
    type:
      'FeatureCollection',
    features: []
  });
}

/* ========= HANDLERS MAP ========= */
async function onClickPointGeneric(e) {
  const feature = e?.features?.[0];
  if (!feature) return;

  const layerId = feature?.layer?.id || '';
  const sourceKey = pointLayerSourceMap[layerId];
  if (!sourceKey) return;

  await handlePointClick(feature, sourceKey);
}

function onClickClusterGeneric(e) {
  const feature = e?.features?.[0];
  if (!feature) return;

  const layerId = feature?.layer?.id || '';
  const sourceKey = clusterLayerSourceMap[layerId];
  if (!sourceKey) return;

  handleClusterClick(feature, sourceKey);
}

function bindMapInteractions() {
  Object.keys(clusterLayerSourceMap).forEach((layerId) => {
    map.off('mouseenter', layerId, onEnterPointer);
    map.off('mouseleave', layerId, onLeavePointer);
    map.off('click', layerId, onClickClusterGeneric);

    map.on('mouseenter', layerId, onEnterPointer);
    map.on('mouseleave', layerId, onLeavePointer);
    map.on('click', layerId, onClickClusterGeneric);
  });

  Object.keys(pointLayerSourceMap).forEach((layerId) => {
    map.off('mouseenter', layerId, onEnterPointer);
    map.off('mouseleave', layerId, onLeavePointer);
    map.off('click', layerId, onClickPointGeneric);

    map.on('mouseenter', layerId, onEnterPointer);
    map.on('mouseleave', layerId, onLeavePointer);
    map.on('click', layerId, onClickPointGeneric);
  });

  map.off('movestart', clearAllCrosshairState);
  map.off('zoomstart', clearAllCrosshairState);

  map.off('moveend', refreshBestCrosshairAfterMove);
  map.off('zoomend', refreshBestCrosshairAfterMove);

  map.on('movestart', clearAllCrosshairState);
  map.on('zoomstart', clearAllCrosshairState);

  map.on('moveend', () => {
    const currentTarget = getCurrentCrosshairTarget();

    // 🔹 nascondi crosshair solo se il target
    // non è più renderizzato stabilmente
    if (currentTarget) {
      const pointMatch =
        getRenderedPointMatch(currentTarget);

      if (!pointMatch) {
        hideHtmlCrosshair();
      }
    }

    Object.keys(clusterLeavesCache).forEach(k => delete clusterLeavesCache[k]);
    Object.keys(clusterBestLeafCache).forEach(k => delete clusterBestLeafCache[k]);

    sourceKeys.forEach((sourceKey) => {
      const source = map.getSource(sourceKey);
      if (!source) return;

      const geojson =
        buildSuperclusterGeoJSON(sourceKey);

      source.setData(geojson);
    });

    refreshBestCrosshairAfterMove();
  });

  map.on('zoomend', () => {
    refreshBestCrosshairAfterMove();

    Object.keys(clusterLeavesCache).forEach(k => delete clusterLeavesCache[k]);
    Object.keys(clusterBestLeafCache).forEach(k => delete clusterBestLeafCache[k]);

    sourceKeys.forEach((sourceKey) => {
      const source = map.getSource(sourceKey);
      if (!source) return;

      const geojson = buildSuperclusterGeoJSON(sourceKey);
      source.setData(geojson);
    });
  });
}

function handleClusterClick(feature, sourceKey) {
  if (!feature) return;

  const clusterId = feature.properties?.cluster_id;
  if (clusterId == null) return;

  const sc = superclusterIndex[sourceKey];
  if (!sc) return;

  const expansionZoom = sc.getClusterExpansionZoom(clusterId);

  const bestLeaf = getBestLeafFromCluster(sourceKey, feature);

  if (bestLeaf) {
    updatePanel(bestLeaf, sourceKey);

    const target = buildTargetFromFeature(bestLeaf, sourceKey);

    target.clusterId = feature.properties?.cluster_id || null;

    setSelectedCrosshairTarget(target);
    setActiveCardOverlayForced(true);
  }

  map.easeTo({
    center: feature.geometry.coordinates,
    zoom: expansionZoom,
    duration: 800,
    easing: (t) => 1 - Math.pow(1 - t, 3)
  });
}

function onEnterPointer(e) {
  map.getCanvas().style.cursor = 'pointer';

  const feature = e && e.features && e.features[0];
  if (!feature) return;

  const layerId = (feature.layer && feature.layer.id) || '';

  // 🔹 POINT
  const pointSourceKey = pointLayerSourceMap[layerId];
  if (pointSourceKey) {
    const target = buildTargetFromFeature(feature, pointSourceKey);
    if (target) {
      activateHover(target);
      syncActiveCardOverlayWithFeature(feature, pointSourceKey);
    }
    return;
  }

  // 🔹 CLUSTER
  const clusterSourceKey = clusterLayerSourceMap[layerId];
  if (clusterSourceKey) {
    const coords = feature.geometry?.coordinates;
    if (!coords) return;

    const target = createCrosshairTarget({
      lon: coords[0],
      lat: coords[1],
      rawLon: coords[0],
      rawLat: coords[1],
      sourceKey: clusterSourceKey,
      identity: {
        size: Number(feature.properties?.maxSize) || 1,
        clusterId: feature.properties?.cluster_id || null
      }
    });

    if (target) {
      activateHover(target);
    }

    // 🔹 se il cluster contiene il punto selezionato → overlay ON
    if (selectedCrosshairTarget) {
      const bestLeaf = getBestLeafFromCluster(clusterSourceKey, feature);
      if (!bestLeaf) return;

      const leafIdentity = getFeatureIdentity(bestLeaf);

      if (isSameFeatureIdentity(leafIdentity, selectedCrosshairTarget)) {
        setActiveCardOverlayForced(true);
      }
    }

    return;
  }

  // 🔹 fallback
  clearInteraction();
}

function onLeavePointer() {
  map.getCanvas().style.cursor = '';

  clearInteraction();
}

function setupTouchClearFallback() {
  const clear = (e) => {
    if (e.pointerType !== 'touch') return;

    setActiveCardOverlayForced(false);
    hideCrosshair();

    window.removeEventListener('pointerdown', clear);
    map.off('movestart', clear);
    map.off('zoomstart', clear);
  };

  window.addEventListener('pointerdown', clear, { once: true });
  map.on('movestart', clear);
  map.on('zoomstart', clear);
}

async function handlePointClick(feature, sourceKey) {
  if (!feature) return;
  isClickInteraction = true;

  const coords = feature.geometry && feature.geometry.coordinates;

  const canonicalFeature = await resolveCanonicalFeature(feature, sourceKey);

  updatePanel(canonicalFeature, sourceKey);

  // 🔹 nuova gestione unificata
  const target = buildTargetFromFeature(canonicalFeature, sourceKey);
  activateSelection(target);

  syncAdaptiveProjection();

  if (coords) {
    const currentZoom = map.getZoom();
    const maxClickZoom = 10;

    const nextZoom = currentZoom >= maxClickZoom
      ? currentZoom
      : Math.min(currentZoom + 2, maxClickZoom);

    map.stop(); // 👈 importante per evitare conflitti

    isProgrammaticMove = true;
    map.easeTo({
      center: coords,
      zoom: nextZoom,
      duration: 800,
      easing: (t) => 1 - Math.pow(1 - t, 3)
    });

    map.once('moveend', () => {
      isClickInteraction = false;
    });
  }
}

/* ========= RANDOM FEATURE SIZE 2 ========= */
async function loadGeoJSON(url) {
  if (geojsonCache[url]) return geojsonCache[url];

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);

  const data = await res.json();
  geojsonCache[url] = data;
  return data;
}

function preloadGeoJSONs() {
  if (geojsonPreloadPromise) return geojsonPreloadPromise;

  geojsonPreloadPromise = Promise.all(
    sourceKeys.map((sourceKey) =>
      loadGeoJSON(getGeoJsonUrlForSource(sourceKey)).catch(() => null)
    )
  );

  return geojsonPreloadPromise;
}

function buildSuperclusterIndex() {
  sourceKeys.forEach((sourceKey) => {
    const geojson = geojsonCache[getGeoJsonUrlForSource(sourceKey)];
    if (!geojson) return;

    const points = geojson.features
      .filter(f => f.geometry?.type === 'Point')
      .map(f => ({
        type: 'Feature',
        properties: {
          ...f.properties,
          sourceKey
        },
        geometry: {
          type: 'Point',
          coordinates: f.geometry.coordinates
        }
      }));

    const index = new Supercluster({
      radius: 85,
      maxZoom: 8,

      map: (props) => ({
        maxSize: props.size || 1
      }),

      reduce: (accumulated, props) => {
        accumulated.maxSize = Math.max(
          accumulated.maxSize || 1,
          props.maxSize || 1
        );
      }
    });

    index.load(points);

    superclusterIndex[sourceKey] = index;
  });
}

function getSuperclusterFeatures(sourceKey) {
  const sc = superclusterIndex[sourceKey];
  if (!sc) return [];

  const bounds = map.getBounds();
  const zoom = Math.round(map.getZoom());

  const clusters = sc.getClusters(
    [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth()
    ],
    zoom
  );

  return clusters.map(f => {
    const isCluster = !!f.properties.cluster;

    return {
      type: isCluster ? 'cluster' : 'point',

      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],

      size: isCluster
        ? f.properties.maxSize || 1
        : f.properties.size || 1,

      clusterId: f.properties.cluster_id || null,
      pointCount: f.properties.point_count || 1,

      raw: f
    };
  });
}

function buildSuperclusterGeoJSON(sourceKey) {
  const features = getSuperclusterFeatures(sourceKey);

  return {
    type: 'FeatureCollection',
    features: features.map(f => {
      let lon = f.lon;
      let lat = f.lat;

      const originalProps = (f.raw && f.raw.properties) ? f.raw.properties : {};

      // 🔹 Override posizione per cluster
      if (f.type === 'cluster' && f.clusterId != null) {
        const best = getBestLeafFromCluster(sourceKey, f.raw);

        if (best?.geometry?.coordinates) {
          lon = best.geometry.coordinates[0];
          lat = best.geometry.coordinates[1];
        }
      }

      return {
        type: 'Feature',
       
        properties: {
          size: f.size,
          maxSize: f.size,
          cluster: f.type === 'cluster',
          point_count: f.type === 'cluster' ? f.pointCount : undefined,
          cluster_id: f.clusterId,
          sourceKey,

          // 👇 fondamentale per il matching
          name: originalProps.name || '',
          country: originalProps.country || '',
          gx_media_links: originalProps.gx_media_links || '',
          description: originalProps.description || ''
        },
        geometry: {
          type: 'Point',
          coordinates: [lon, lat]
        }
      };
    })
  };
}

function getClusterLeaves(sourceKey, clusterId) {
  if (!clusterId && clusterId !== 0) return [];

  const key = sourceKey + '_' + clusterId;

  if (clusterLeavesCache[key]) {
    return clusterLeavesCache[key];
  }

  const sc = superclusterIndex[sourceKey];
  if (!sc) return [];

  const leaves = sc.getLeaves(clusterId, Infinity) || [];

  clusterLeavesCache[key] = leaves;

  return leaves;
}

function getBestLeafFromCluster(sourceKey, clusterFeature) {
  if (!clusterFeature || !clusterFeature.properties) return null;

  const clusterId = clusterFeature.properties.cluster_id;
  if (clusterId == null) return null;

  const key = sourceKey + '_' + clusterId;

  // 👉 cache hit
  if (clusterBestLeafCache[key]) {
    return clusterBestLeafCache[key];
  }

  const leaves = getClusterLeaves(sourceKey, clusterId);
  if (!leaves || !leaves.length) return null;

  const center = clusterFeature.geometry && clusterFeature.geometry.coordinates;
  if (!center) return null;

  const centerLon = center[0];
  const centerLat = center[1];

  // 👉 1. trova size max
  let maxSize = 1;
  for (let i = 0; i < leaves.length; i++) {
    const s = leaves[i].properties && leaves[i].properties.size || 1;
    if (s > maxSize) maxSize = s;
  }

  // 👉 2. trova il più vicino tra quelli con size max
  let best = null;
  let bestDist = Infinity;

  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    const size = leaf.properties && leaf.properties.size || 1;
    if (size !== maxSize) continue;

    const coords = leaf.geometry && leaf.geometry.coordinates;
    if (!coords) continue;

    const dx = coords[0] - centerLon;
    const dy = coords[1] - centerLat;
    const dist = dx * dx + dy * dy;

    if (dist < bestDist) {
      bestDist = dist;
      best = leaf;
    }
  }

  // 👉 salva in cache
  if (best) {
    clusterBestLeafCache[key] = best;
  }

  return best;
}

function getFeatureIdentity(feature) {
  return {
    name:
      (feature?.properties?.name && feature.properties.name.trim()) ||
      (feature?.properties?.title && feature.properties.title.trim()) ||
      '',

    country:
      (feature?.properties?.country && feature.properties.country.trim()) || '',

    size: Number(feature?.properties?.size) || 1,

    mediaLink:
      (feature?.properties?.gx_media_links &&
        String(feature.properties.gx_media_links).trim()) || '',

    description:
      (feature?.properties?.description &&
        String(feature.properties.description).trim()) || ''
  };
}

function findNearestGeojsonPoint(lon, lat, maxDistance = 1.5) {
  let best = null;
  let bestDist = Infinity;

  const activeSources = getActiveSourceKeys();
  if (!activeSources.length) return null;

  activeSources.forEach((sourceKey) => {
    const geojson = geojsonCache[getGeoJsonUrlForSource(sourceKey)];
    if (!geojson?.features) return;

    geojson.features.forEach((f) => {
      if (f.geometry?.type !== 'Point') return;

      const [flon, flat] = f.geometry.coordinates;

      const dx = flon - lon;
      const dy = flat - lat;
      const dist = dx * dx + dy * dy;

      if (dist < bestDist) {
        bestDist = dist;
        best = { feature: f, sourceKey };
      }
    });
  });

  if (!best) return null;
  if (bestDist > maxDistance * maxDistance) return null;

  return best;
}

function getActiveSourceKeys() {
  return Array.from(document.querySelectorAll('.layer-toggle.active'))
    .map(el => el.dataset.layer)
    .filter(Boolean);
}

function isSameFeatureIdentity(a, b) {
  return (
    a.name === b.name &&
    a.country === b.country &&
    a.size === b.size &&
    a.mediaLink === b.mediaLink &&
    a.description === b.description
  );
}

function getFeatureIdentityFromDataset(dataset) {
  return {
    name: dataset.name || '',
    country: dataset.country || '',
    size: Number(dataset.size) || 1,
    mediaLink: dataset.mediaLink || '',
    description: dataset.description || ''
  };
}

function createCrosshairTarget({
  lon,
  lat,
  rawLon,
  rawLat,
  sourceKey,
  identity
}) {
  if (!sourceKey) return null;
  if (!Number.isFinite(Number(lon)) || !Number.isFinite(Number(lat))) return null;

  const id = identity || {};

  return {
    lon: Number(lon),
    lat: Number(lat),
    rawLon: rawLon != null ? Number(rawLon) : Number(lon),
    rawLat: rawLat != null ? Number(rawLat) : Number(lat),

    size: Number(id.size) || 1,
    sourceKey,

    name: id.name || '',
    country: id.country || '',
    mediaLink: id.mediaLink || '',
    description: id.description || '',

    // 👉 fondamentale per riconoscere i cluster selezionati
    clusterId: id.clusterId != null ? id.clusterId : null
  };
}

function getFeatureDisplayCoordinates(feature) {
  const rawCoords = (
    feature?.geometry &&
    feature.geometry.type === 'Point' &&
    Array.isArray(feature.geometry.coordinates)
  )
    ? feature.geometry.coordinates
    : null;

  if (!rawCoords) {
    return {
      rawCoords: null,
      rawLon: null,
      rawLat: null,
      visualLon: null,
      visualLat: null
    };
  }

  const rawLon = Number(rawCoords[0]);
  const rawLat = Number(rawCoords[1]);
  const visualLon = Number(feature.properties?.__visualLon ?? rawLon);
  const visualLat = Number(feature.properties?.__visualLat ?? rawLat);

  return {
    rawCoords,
    rawLon,
    rawLat,
    visualLon,
    visualLat
  };
}

function normalizeFeature(feature, sourceKey = null) {
  const identity = getFeatureIdentity(feature);
  const coords = getFeatureDisplayCoordinates(feature);

  return {
    feature,
    sourceKey: sourceKey || feature?.properties?.__sourceKey || '',
    identity,
    coords
  };
}

function setActiveCardOverlayData(normalizedFeature) {
  const overlay = document.querySelector('.panel-card.is-active .image-overlay');
  if (!overlay) return;

  const { identity, coords, sourceKey } = normalizedFeature;
  const { visualLon, visualLat, rawLon, rawLat } = coords;

  if (visualLon == null || visualLat == null) return;

  overlay.dataset.lon = visualLon;
  overlay.dataset.lat = visualLat;
  overlay.dataset.rawLon = rawLon ?? visualLon;
  overlay.dataset.rawLat = rawLat ?? visualLat;
  overlay.dataset.size = identity.size;
  overlay.dataset.sourceKey = sourceKey || '';
  overlay.dataset.name = identity.name;
  overlay.dataset.country = identity.country;
  overlay.dataset.mediaLink = identity.mediaLink;
  overlay.dataset.description = identity.description;
}

function getFeatureImageUrl(feature) {
  const properties = feature?.properties || {};
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

  const imgMatch = htmlContent.match(/<img[^>]+src="([^">]+)"/);
  if (imgMatch && imgMatch[1]) {
    return imgMatch[1];
  }

  if (properties.gx_media_links) {
    return properties.gx_media_links;
  }

  return null;
}

async function resolveCanonicalFeature(feature, sourceKey) {
  if (!feature?.geometry || feature.geometry.type !== 'Point') return feature;

  const url = getGeoJsonUrlForSource(sourceKey);
  const raw = await loadGeoJSON(url).catch(() => null);
  if (!raw?.features?.length) return feature;

  const [clickedLon, clickedLat] = feature.geometry.coordinates;
  const clickedIdentity = getFeatureIdentity(feature);

  const exactPropertyMatch = raw.features.find((candidate) => {
    if (!candidate?.geometry || candidate.geometry.type !== 'Point') return false;

    const candidateIdentity = getFeatureIdentity(candidate);

    return (
      candidateIdentity.name === clickedIdentity.name &&
      candidateIdentity.country === clickedIdentity.country &&
      candidateIdentity.size === clickedIdentity.size &&
      candidateIdentity.mediaLink === clickedIdentity.mediaLink &&
      candidateIdentity.description === clickedIdentity.description
    );
  });

  if (exactPropertyMatch) {
    return {
      ...exactPropertyMatch,
      properties: {
        ...(exactPropertyMatch.properties || {}),
        __visualLon: clickedLon,
        __visualLat: clickedLat
      }
    };
  }

  const exactCoordinateMatch = raw.features.find((candidate) => {
    if (!candidate?.geometry || candidate.geometry.type !== 'Point') return false;

    const [lon, lat] = candidate.geometry.coordinates;
    return areSameCoordinates(lon, lat, clickedLon, clickedLat, 1e-9);
  });

  if (exactCoordinateMatch) {
    return exactCoordinateMatch;
  }

  let bestMatch = null;
  let bestScore = Infinity;

  for (const candidate of raw.features) {
    if (!candidate?.geometry || candidate.geometry.type !== 'Point') continue;

    const [lon, lat] = candidate.geometry.coordinates;
    const candidateIdentity = getFeatureIdentity(candidate);

    let score = Math.abs(lon - clickedLon) + Math.abs(lat - clickedLat);

    if (candidateIdentity.size !== clickedIdentity.size) score += 1000;
    if (clickedIdentity.name && candidateIdentity.name !== clickedIdentity.name) score += 100;
    if (clickedIdentity.country && candidateIdentity.country !== clickedIdentity.country) score += 10;

    if (score < bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  const resolved = bestMatch || feature;

  return {
    ...resolved,
    properties: {
      ...(resolved.properties || {}),
      __visualLon: clickedLon,
      __visualLat: clickedLat
    }
  };
}

function isSize2Feature(f) {
  const size = f?.properties?.size;
  return Number(size) === 2 && f?.geometry?.type === 'Point';
}

async function pickRandomSize2FromSources() {
  await preloadGeoJSONs();

  const candidates = sourceKeys.flatMap((sourceKey) => {
    const geojson = geojsonCache[getGeoJsonUrlForSource(sourceKey)] || null;

    return (geojson?.features || [])
      .filter(isSize2Feature)
      .map((feature) => ({
        ...feature,
        properties: {
          ...(feature.properties || {}),
          __sourceKey: sourceKey
        }
      }));
  });

  if (!candidates.length) return null;

  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx];
}

async function showStartupRandomSize2Card() {
  if (startupRandomShown) return;
  startupRandomShown = true;

  try {
    await preloadGeoJSONs();

    const f = await pickRandomSize2FromSources();
    if (f) updatePanel(f, f.properties?.__sourceKey || null);
  } catch (e) {
    console.warn('Startup random size=2 failed:', e);
  }
}

async function showRandomSize2Card() {
  try {
    const f = await pickRandomSize2FromSources();
    if (f) updatePanel(f, f.properties?.__sourceKey || null);
  } catch (e) {
    console.warn('Random refresh failed:', e);
  }
}

/* ========= PANEL ========= */
function updatePanel(feature, sourceKey = null) {
  const normalizedFeature = normalizeFeature(feature, sourceKey);
  const { identity, coords } = normalizedFeature;

  const coordsText =
    coords.visualLon != null && coords.visualLat != null
      ? formatCoords(coords.visualLat, coords.visualLon)
      : '';

  const coordsTextEl = document.querySelector('.panel-card.is-active .coords-text');
  if (coordsTextEl) coordsTextEl.textContent = coordsText;

  const coordsDot =
    document.querySelector(
      '.panel-card.is-active .card-coords-dot'
    );

  if (coordsDot) {
    coordsDot.className =
      'card-coords-dot';

    const size =
      Number(identity.size) || 1;

    const layer =
      normalizedFeature.sourceKey || '';

    coordsDot.classList.add(
      `size-${size}`
    );

    if (layer) {
      coordsDot.classList.add(
        `layer-${layer}`
      );
    }
  }

  setActiveCardOverlayData(normalizedFeature);

  const titleTextEl =
    document.querySelector(
      '.panel-card.is-active .title-text'
    );

  if (titleTextEl) {
    titleTextEl.textContent =
      identity.name || 'Senza nome';
  }

  const imageUrl = getFeatureImageUrl(feature);
  const imgEl = document.querySelector('.panel-card.is-active .panel-image');

  if (imgEl && imageUrl) {
    const proxiedUrl =
      'https://pingeo-image-proxy.danielecinquini1.workers.dev/image?url=' +
      encodeURIComponent(imageUrl);

    preloadImage(proxiedUrl, (loadedUrl) => {
      if (loadedUrl) {
        imgEl.src = loadedUrl;
        imgEl.style.display = 'block';
      }
    });
  } else if (imgEl) {
    imgEl.style.display = 'none';
  }

  const overlayDescEl = document.querySelector('.panel-card.is-active .overlay-description');
  if (overlayDescEl) overlayDescEl.textContent = identity.country;

  refreshPanelLayout();
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
    const target = buildTargetFromActiveCard();
    if (!target) return;

    const currentZoom = map.getZoom();
    const maxZoom = 10;
    const nextZoom = Math.min(currentZoom + 2, maxZoom);

    isClickInteraction = true;

    map.stop();
    map.easeTo({
      center: [lon, lat],
      zoom: nextZoom,
      duration: 950,
      easing: (t) => 1 - Math.pow(1 - t, 3)
    });

    activateSelection(target);

    map.once('moveend', () => {
      isClickInteraction = false;
    });
  }
});

/* ========= CARD HOVER -> CROSSHAIR ========= */
document.getElementById('panel')?.addEventListener('mouseover', (e) => {
  const wrapper = e.target.closest('.panel-card.is-active .image-wrapper');
  if (!wrapper) return;

  if (wrapper.contains(e.relatedTarget)) return;

  const target = normalizeCrosshairTarget(buildTargetFromActiveCard());
  if (target) showBestCrosshairForTarget(target);
});

document.getElementById('panel')?.addEventListener('mouseout', (e) => {
  const wrapper = e.target.closest('.panel-card.is-active .image-wrapper');
  if (!wrapper) return;

  if (wrapper.contains(e.relatedTarget)) return;

  setActiveCardOverlayForced(false);

  hideCrosshair();
  setupTouchClearFallback();
});

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

  toggle.classList.add('active');

  toggle.addEventListener('click', () => {
    const isActive = toggle.classList.toggle('active');
    setLayerGroupVisibility(layerKey, isActive);
  });
});

/* ========= LOAD ========= */
map.on('load', () => {
  refreshPanelLayout();

  map.addControl(new ZoomAndStyleControl(), 'top-right');
  map.addControl(new DualScaleControl(), 'top-left');

  setupGeocoderOnce();
  setupMapInteractionClear();
  setupUserInputClear();
  preloadGeoJSONs().then(() => {
    buildSuperclusterIndex();
  });
  initDataLayers();
  ensureCrosshairHighlightLayers();
  ensureCrosshairRingLayer();
  bindMapInteractions();
  lockZenithNorth();
  initializeAdaptiveProjection('globe');

  map.setMinZoom(1.8);

  map.once('idle', () => {

    Object.keys(clusterLeavesCache).forEach(k => delete clusterLeavesCache[k]);
    Object.keys(clusterBestLeafCache).forEach(k => delete clusterBestLeafCache[k]);
    
    sourceKeys.forEach((sourceKey) => {
      const source = map.getSource(sourceKey);
      if (!source) return;

      const geojson = buildSuperclusterGeoJSON(sourceKey);
      source.setData(geojson);
    });
  });
});

/* ========= STYLE LOAD ========= */
map.on('style.load', () => {
  initDataLayers();

  ensureCrosshairHighlightLayers();
  ensureCrosshairRingLayer();

  lockZenithNorth();

  initializeAdaptiveProjection(
    adaptiveProjectionMode
  );

  refreshCrosshair();
});

window.addEventListener('resize', () => {
  refreshPanelLayout();
  refreshCrosshair();
});

/* ========= ADAPTIVE PROJECTION ========= */
map.on('zoom', syncAdaptiveProjection);
map.on('moveend', syncAdaptiveProjection);

/* ========= LOCK NORTH / NO ROTATION ========= */
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
  showRandomSize2Card();
});