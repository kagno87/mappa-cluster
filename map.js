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
let crosshairMarker = null;
let selectedCrosshairTarget = null;
let adaptiveProjectionMode = 'globe';

const geojsonCache = {};
let geojsonPreloadPromise = null;

/* ========= STARTUP ========= */
window.addEventListener('DOMContentLoaded', () => {
  refreshPanelLayout();
  showRandomSize2OnStartup();
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
function getCrosshairMetrics(sizeValue) {
  const size = Number(sizeValue) || 1;

  switch (size) {
    case 1:
      return { gap: 13, arm: 8, stroke: 2.5 };
    case 2:
      return { gap: 17, arm: 10, stroke: 2.5 };
    case 3:
      return { gap: 21, arm: 12, stroke: 2.5 };
    default:
      return { gap: 13, arm: 8, stroke: 2.5 };
  }
}

function ensureHtmlCrosshair() {
  if (crosshairMarker) {
    return crosshairMarker.getElement();
  }

  const el = document.createElement('div');
  el.className = 'crosshair-html';

  const parts = [
    'left outline', 'right outline', 'top outline', 'bottom outline',
    'left main', 'right main', 'top main', 'bottom main'
  ];

  parts.forEach((cls) => {
    const arm = document.createElement('div');
    arm.className = `arm ${cls}`;
    el.appendChild(arm);
  });

  crosshairMarker = new mapboxgl.Marker({
    element: el,
    anchor: 'center'
  })
    .setLngLat([0, 0])
    .addTo(map);

  return el;
}

function positionCrosshairArms(container, metrics) {
  const { gap, arm, stroke } = metrics;

  const leftMain = container.querySelector('.arm.left.main');
  const rightMain = container.querySelector('.arm.right.main');
  const topMain = container.querySelector('.arm.top.main');
  const bottomMain = container.querySelector('.arm.bottom.main');

  const leftOutline = container.querySelector('.arm.left.outline');
  const rightOutline = container.querySelector('.arm.right.outline');
  const topOutline = container.querySelector('.arm.top.outline');
  const bottomOutline = container.querySelector('.arm.bottom.outline');

  function setBox(el, x, y, w, h) {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
  }

  setBox(leftOutline, -(gap + arm), -2.5, arm, 5);
  setBox(rightOutline, gap, -2.5, arm, 5);
  setBox(topOutline, -2.5, -(gap + arm), 5, arm);
  setBox(bottomOutline, -2.5, gap, 5, arm);

  setBox(leftMain, -(gap + arm), -(stroke / 2), arm, stroke);
  setBox(rightMain, gap, -(stroke / 2), arm, stroke);
  setBox(topMain, -(stroke / 2), -(gap + arm), stroke, arm);
  setBox(bottomMain, -(stroke / 2), gap, stroke, arm);
}

function renderHtmlCrosshair(lon, lat, sizeValue) {
  const el = ensureHtmlCrosshair();
  if (!el) return;

  const metrics = getCrosshairMetrics(sizeValue);

  if (crosshairMarker) {
    crosshairMarker.setLngLat([lon, lat]);
  }

  el.style.opacity = '1';
  el.style.display = 'block';

  positionCrosshairArms(el, metrics);
}

function hideHtmlCrosshair() {
  if (!crosshairMarker) return;

  const el = crosshairMarker.getElement();
  if (!el) return;

  el.style.opacity = '0';
  el.style.display = 'none';
}

function refreshHtmlCrosshair() {
  if (!activeCrosshair) return;
  renderHtmlCrosshair(activeCrosshair.lon, activeCrosshair.lat, activeCrosshair.size);
}

function renderCrosshair(lon, lat, sizeValue) {
  activeCrosshair = {
    lon: Number(lon),
    lat: Number(lat),
    size: Number(sizeValue) || 1
  };

  renderHtmlCrosshair(
    activeCrosshair.lon,
    activeCrosshair.lat,
    activeCrosshair.size
  );
}

function hideCrosshair() {
  activeCrosshair = null;
  activeHoverTarget = null;
  crosshairRequestToken += 1;
  hideHtmlCrosshair();
  syncAdaptiveProjection();
}

function hideCrosshairKeepTarget() {
  activeCrosshair = null;
  crosshairRequestToken += 1;
  hideHtmlCrosshair();
}

function hideHoverCrosshairOnly() {
  activeCrosshair = null;
  activeHoverTarget = null;
  crosshairRequestToken += 1;
  hideHtmlCrosshair();
}

function clearAllCrosshairState() {
  activeCrosshair = null;
  activeHoverTarget = null;
  selectedCrosshairTarget = null;
  crosshairRequestToken += 1;
  hideHtmlCrosshair();
  setActiveCardOverlayForced(false);
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
  return sourceKey === 'nero' ? 'nero-points' : 'unclustered-point-bianco';
}

function getClusterLayerIdForSource(sourceKey) {
  return sourceKey === 'nero' ? 'clusters-nero' : 'clusters-bianco';
}

function clusterContainsTarget(source, clusterId, target, leafLimit = 1000) {
  return new Promise((resolve) => {
    source.getClusterLeaves(clusterId, leafLimit, 0, (err, leaves) => {
      if (err || !Array.isArray(leaves)) {
        resolve(false);
        return;
      }

      const targetLon = Number(target.rawLon ?? target.lon);
      const targetLat = Number(target.rawLat ?? target.lat);
      const targetIdentity = {
        name: target.name || '',
        country: target.country || '',
        size: Number(target.size) || 1,
        mediaLink: target.mediaLink || '',
        description: target.description || ''
      };

      const found = leaves.some((leaf) => {
        if (!leaf?.geometry || leaf.geometry.type !== 'Point') return false;

        const leafIdentity = getFeatureIdentity(leaf);
        if (isSameFeatureIdentity(leafIdentity, targetIdentity)) return true;

        const [lon, lat] = leaf.geometry.coordinates;
        return (
          Math.abs(Number(lon) - targetLon) <= 1e-5 &&
          Math.abs(Number(lat) - targetLat) <= 1e-5
        );
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
  if (!renderedClusters.length) return null;

  const targetPixel = map.project([Number(target.lon), Number(target.lat)]);
  const matches = [];

  for (const feature of renderedClusters) {
    if (!feature?.geometry || feature.geometry.type !== 'Point') continue;

    const clusterId = feature.properties?.cluster_id;
    if (clusterId == null) continue;

    const leafLimit = Number(feature.properties?.point_count) || 1000;
    const containsTarget = await clusterContainsTarget(source, clusterId, target, leafLimit);
    if (!containsTarget) continue;

    const [lon, lat] = feature.geometry.coordinates;
    const pixel = map.project([lon, lat]);

    const dx = pixel.x - targetPixel.x;
    const dy = pixel.y - targetPixel.y;
    const distSq = dx * dx + dy * dy;

    matches.push({
      lon,
      lat,
      size: Number(feature.properties?.maxSize) || target.size || 1,
      distSq
    });
  }

  if (!matches.length) return null;

  matches.sort((a, b) => a.distSq - b.distSq);
  return matches[0];
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

function showBestCrosshairForTarget(target) {
  const normalizedTarget = normalizeCrosshairTarget(target);
  if (!normalizedTarget) return;

  setHoverCrosshairTarget(normalizedTarget);

  syncAdaptiveProjection();
  hideCrosshairKeepTarget();

  const requestToken = ++crosshairRequestToken;

  requestAnimationFrame(async () => {
    if (requestToken !== crosshairRequestToken) return;

    const pointMatch = getRenderedPointMatch(normalizedTarget);
    if (pointMatch) {
      if (requestToken !== crosshairRequestToken) return;
      renderCrosshair(pointMatch.lon, pointMatch.lat, pointMatch.size);
      return;
    }

    const clusterMatch = await getRenderedClusterMatch(normalizedTarget);
    if (clusterMatch) {
      if (requestToken !== crosshairRequestToken) return;
      renderCrosshair(clusterMatch.lon, clusterMatch.lat, clusterMatch.size);
      return;
    }

    const fallbackMatch = getNearestRenderedFeatureForTarget(normalizedTarget, 80);
    if (fallbackMatch) {
      if (requestToken !== crosshairRequestToken) return;
      renderCrosshair(fallbackMatch.lon, fallbackMatch.lat, fallbackMatch.size);
      return;
    }

    if (requestToken !== crosshairRequestToken) return;
    hideCrosshairKeepTarget();
  });
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
  const searchContainer = document.getElementById('search-container');

  if (
    !searchContainer ||
    typeof MapboxGeocoder === 'undefined' ||
    searchContainer.querySelector('.mapboxgl-ctrl-geocoder')
  ) {
    return;
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
  if (!input) return;

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;

    const query = input.value.trim();
    const match = query.match(/^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/);
    if (!match) return;

    const a = parseFloat(match[1]);
    const b = parseFloat(match[3]);
    const coords = getCoordsFromSimplePair(a, b);

    if (!coords) return;

    e.preventDefault();

    map.flyTo({
      center: [coords.lon, coords.lat],
      zoom: 12,
      speed: 1.2
    });
  });
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
function initDataLayers() {
  addSourcesIfMissing();
  addLayersIfMissing();
  applyLayerToggleState();
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

  map.off('movestart', clearAllCrosshairState);
  map.off('zoomstart', clearAllCrosshairState);

  map.off('moveend', refreshBestCrosshairAfterMove);
  map.off('zoomend', refreshBestCrosshairAfterMove);

  map.on('movestart', clearAllCrosshairState);
  map.on('zoomstart', clearAllCrosshairState);

  map.on('moveend', refreshBestCrosshairAfterMove);
  map.on('zoomend', refreshBestCrosshairAfterMove);
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

  const layerId = feature?.layer?.id || '';

  if (layerId === 'nero-points') {
    const target = buildTargetFromFeature(feature, 'nero');
    if (target) {
      showBestCrosshairForTarget(target);
      syncActiveCardOverlayWithFeature(feature, 'nero');
    }
    return;
  }

  if (layerId === 'unclustered-point-bianco') {
    const target = buildTargetFromFeature(feature, 'bianco');
    if (target) {
      showBestCrosshairForTarget(target);
      syncActiveCardOverlayWithFeature(feature, 'bianco');
    }
    return;
  }

  if (layerId === 'clusters-nero') {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords)) return;

    const target = createCrosshairTarget({
      lon: coords[0],
      lat: coords[1],
      rawLon: coords[0],
      rawLat: coords[1],
      sourceKey: 'nero',
      identity: {
        size: Number(feature?.properties?.maxSize) || 1
      }
    });

    if (target) {
      setHoverCrosshairTarget(target);
      renderCrosshair(target.lon, target.lat, target.size);
    }

    setActiveCardOverlayForced(false);
    return;
  }

  if (layerId === 'clusters-bianco') {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords)) return;

    const target = createCrosshairTarget({
      lon: coords[0],
      lat: coords[1],
      rawLon: coords[0],
      rawLat: coords[1],
      sourceKey: 'bianco',
      identity: {
        size: Number(feature?.properties?.maxSize) || 1
      }
    });

    if (target) {
      setHoverCrosshairTarget(target);
      renderCrosshair(target.lon, target.lat, target.size);
    }

    setActiveCardOverlayForced(false);
    return;
  }

  setActiveCardOverlayForced(false);
  hideCrosshair();
}

function onLeavePointer() {
  map.getCanvas().style.cursor = '';
  setActiveCardOverlayForced(false);
  hideHoverCrosshairOnly();
}

async function onClickNeroPoint(e) {
  const feature = e?.features?.[0];
  if (!feature) return;

  const canonicalFeature = await resolveCanonicalFeature(feature, 'nero');

  updatePanel(canonicalFeature, 'nero');
  setSelectedCrosshairTarget(buildTargetFromFeature(canonicalFeature, 'nero'));
  setActiveCardOverlayForced(true);
  syncAdaptiveProjection();
}

async function onClickBiancoPoint(e) {
  const feature = e?.features?.[0];
  if (!feature) return;

  const canonicalFeature = await resolveCanonicalFeature(feature, 'bianco');

  updatePanel(canonicalFeature, 'bianco');
  setSelectedCrosshairTarget(buildTargetFromFeature(canonicalFeature, 'bianco'));
  setActiveCardOverlayForced(true);
  syncAdaptiveProjection();
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

  geojsonPreloadPromise = Promise.all([
    loadGeoJSON('nero.geojson').catch(() => null),
    loadGeoJSON('bianco.geojson').catch(() => null)
  ]);

  return geojsonPreloadPromise;
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

  return {
    lon: Number(lon),
    lat: Number(lat),
    rawLon: rawLon != null ? Number(rawLon) : Number(lon),
    rawLat: rawLat != null ? Number(rawLat) : Number(lat),
    size: Number(identity?.size) || 1,
    sourceKey,
    name: identity?.name || '',
    country: identity?.country || '',
    mediaLink: identity?.mediaLink || '',
    description: identity?.description || ''
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

  const url = sourceKey === 'nero' ? 'nero.geojson' : 'bianco.geojson';
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

async function pickRandomSize2FromBothLayers() {
  await preloadGeoJSONs();

  const nero = geojsonCache['nero.geojson'] || null;
  const bianco = geojsonCache['bianco.geojson'] || null;

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
    await preloadGeoJSONs();

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

  setActiveCardOverlayData(normalizedFeature);

  const titleTextEl = document.querySelector('.panel-card.is-active .title-text');
  if (titleTextEl) titleTextEl.textContent = identity.name || 'Senza nome';

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
    const currentZoom = map.getZoom();
    const nextZoom = Math.min(currentZoom + 2, 14);

    const zoomChanged = Math.abs(nextZoom - currentZoom) > 0.001;

    // 👉 Se lo zoom NON cambia, aggiorniamo subito senza animazione
    if (!zoomChanged) {
      const target = buildTargetFromActiveCard();
      if (!target) return;

      setSelectedCrosshairTarget(target);
      showBestCrosshairForTarget(target);
      return;
    }

    // 👉 Se lo zoom cambia, comportamento standard
    map.once('moveend', () => {
      const target = buildTargetFromActiveCard();
      if (!target) return;

      setSelectedCrosshairTarget(target);
      showBestCrosshairForTarget(target);
    });

    map.easeTo({
      center: [lon, lat],
      zoom: nextZoom,
      duration: 800
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

  hideCrosshair();
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
  preloadGeoJSONs();
  initDataLayers();
  bindMapInteractions();
  lockZenithNorth();
  initializeAdaptiveProjection('globe');
});

/* ========= STYLE LOAD ========= */
map.on('style.load', () => {
  initDataLayers();
  lockZenithNorth();
  initializeAdaptiveProjection(adaptiveProjectionMode);
});

window.addEventListener('resize', () => {
  refreshPanelLayout();
  refreshCrosshair();
});

/* ========= ADAPTIVE PROJECTION ========= */
map.on('zoom', syncAdaptiveProjection);
map.on('zoomend', syncAdaptiveProjection);
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
  refreshRandomSize2();
});