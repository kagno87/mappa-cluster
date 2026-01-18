mapboxgl.accessToken =
  'pk.eyJ1IjoicGluZ2VvIiwiYSI6ImNtazl2NHducTFlcDUzZXNoMTd0ZzdxMDcifQ.Y9JlBgOGjtP9olv54nHE3g';

/* ========= MAP ========= */
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/light-v11',
  center: [9.2, 45.5],
  zoom: 6
});

map.addControl(new mapboxgl.NavigationControl());

/* ========= PANEL HEIGHT (DEVE STARE QUI, IN ALTO) ========= */
function updatePanelHeight() {
  const panel = document.getElementById('panel');
  if (!panel || !map) return;

  const height = panel.offsetHeight;

  document.documentElement.style.setProperty(
    '--panel-height',
    `${height}px`
  );

  map.setPadding({
    top: 0,
    left: 0,
    right: 0,
    bottom: height
  });
}

/* ========= LOAD ========= */
map.on('load', () => {
  console.log('Mapbox caricato correttamente');

  updatePanelHeight();

  /* ========= SOURCES ========= */
  map.addSource('nero', {
    type: 'geojson',
    data: 'nero.geojson',
    cluster: true,
    clusterRadius: 50,
    clusterMaxZoom: 14
  });

  map.addSource('bianco', {
    type: 'geojson',
    data: 'bianco.geojson',
    cluster: true,
    clusterRadius: 50,
    clusterMaxZoom: 14
  });

  /* ========= CLUSTERS ========= */
  map.addLayer({
    id: 'clusters-nero',
    type: 'circle',
    source: 'nero',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#333',
      'circle-radius': ['step', ['get', 'point_count'], 15, 10, 20, 50, 30],
      'circle-opacity': 0.8
    }
  });

  map.addLayer({
    id: 'nero-cluster-count',
    type: 'symbol',
    source: 'nero',
    filter: ['has', 'point_count'],
    layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 },
    paint: { 'text-color': '#ffffff' }
  });

  map.addLayer({
    id: 'nero-points',
    type: 'circle',
    source: 'nero',
    filter: ['!', ['has', 'point_count']],
    paint: { 'circle-color': '#000000', 'circle-radius': 6 }
  });

  map.addLayer({
    id: 'clusters-bianco',
    type: 'circle',
    source: 'bianco',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#ffffff',
      'circle-radius': ['step', ['get', 'point_count'], 15, 10, 20, 30, 25],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#000000'
    }
  });

  map.addLayer({
    id: 'cluster-count-bianco',
    type: 'symbol',
    source: 'bianco',
    filter: ['has', 'point_count'],
    layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 },
    paint: { 'text-color': '#000000' }
  });

  map.addLayer({
    id: 'unclustered-point-bianco',
    type: 'circle',
    source: 'bianco',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#ffffff',
      'circle-radius': 6,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#000000'
    }
  });

    /* ========= CLICK CLUSTER ========= */
  map.on('click', 'clusters-nero', (e) => {
    const f = e.features && e.features[0];
    if (!f) return;

    map.getSource('nero').getClusterExpansionZoom(
      f.properties.cluster_id,
      (err, zoom) => {
        if (!err) {
          map.easeTo({
            center: f.geometry.coordinates,
            zoom
          });
        }
      }
    );
  });

  map.on('click', 'clusters-bianco', (e) => {
    const f = e.features && e.features[0];
    if (!f) return;

    map.getSource('bianco').getClusterExpansionZoom(
      f.properties.cluster_id,
      (err, zoom) => {
        if (!err) {
          map.easeTo({
            center: f.geometry.coordinates,
            zoom
          });
        }
      }
    );
  });

});

/* ========= CURSORE ========= */
['clusters-nero', 'clusters-bianco', 'nero-points', 'unclustered-point-bianco']
  .forEach(layer => {
    map.on('mouseenter', layer, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', layer, () => map.getCanvas().style.cursor = '');
  });

/* ========= CLICK PIN ========= */
map.on('click', 'nero-points', e => updatePanel(e.features[0]));
map.on('click', 'unclustered-point-bianco', e => updatePanel(e.features[0]));

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

    const lonFixed = Number(lon).toFixed(4);
    const latFixed = Number(lat).toFixed(4);

    coordsText = formatCoords(Number(lat), Number(lon));
  }

  const coordsTextEl = document.getElementById('coords-text');
  if (coordsTextEl) {
    coordsTextEl.textContent = coordsText;
  }

  const overlay = document.querySelector('.image-overlay');

  if (
    overlay &&
    feature.geometry &&
    feature.geometry.type === 'Point'
  ) {
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
    // Caso My Maps con JSON {"@type":"html","value":"..."}
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
    }
    // Caso HTML diretto
    else {
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
      'http://localhost:3000/image?url=' +
      encodeURIComponent(imageUrl);
    imgEl.style.display = 'block';

    preloadImage(proxiedUrl, (loadedUrl) => {
      if (loadedUrl) {
        imgEl.src = loadedUrl;
        imgEl.style.display = 'block';
      }
    });
     
  } else if (imgEl) {
    imgEl.style.display = 'none';
  }

  /* ====== DESCRIZIONE TESTUALE ====== */
  let descriptionText = '';

  if (htmlContent) {
    const parts = htmlContent.split(/<br\s*\/?><br\s*\/?>/i);
    if (parts.length > 1) {
      descriptionText = parts[1];
    }
  }

  descriptionText = descriptionText
    .replace(/name:\s*/gi, '')
    .replace(/description:\s*/gi, '')
    .trim();

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = descriptionText;

  const cleanDescription =
    tempDiv.textContent || tempDiv.innerText || '';

  const overlayDescEl = document.getElementById('overlay-description');
  if (overlayDescEl) overlayDescEl.textContent = cleanDescription;

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

const copyBtn = document.getElementById('coords-copy');

if (copyBtn) {
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    const text = document.getElementById('coords-text')?.textContent;
    if (!text) return;

    navigator.clipboard.writeText(text);
  });
}

const titleCopyBtn = document.getElementById('title-copy');

if (titleCopyBtn) {
  titleCopyBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    const text = document.getElementById('title-text')?.textContent;
    if (!text) return;

    navigator.clipboard.writeText(text);
  });
}

const overlay = document.querySelector('.image-overlay');

if (overlay) {
  overlay.addEventListener('click', (e) => {
    // evita conflitti con i pulsanti copy
    if (e.target.closest('button')) return;

    const lon = parseFloat(overlay.dataset.lon);
    const lat = parseFloat(overlay.dataset.lat);

    
    if (!isNaN(lon) && !isNaN(lat)) {
      map.easeTo({
        center: [lon, lat],
        duration: 800
      });
    }
  });
}


window.addEventListener('resize', updatePanelHeight);
