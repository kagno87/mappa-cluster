mapboxgl.accessToken =
  'pk.eyJ1IjoicGluZ2VvIiwiYSI6ImNtazl2NHducTFlcDUzZXNoMTd0ZzdxMDcifQ.Y9JlBgOGjtP9olv54nHE3g';

/* =========================
   MAPPA
========================= */
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/light-v11',
  center: [9.2, 45.5],
  zoom: 6
});

map.addControl(new mapboxgl.NavigationControl());

/* =========================
   LOAD
========================= */
map.on('load', () => {
  /* ===== SOURCES ===== */
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

  /* ===== LAYERS NERO ===== */
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
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-size': 12
    },
    paint: { 'text-color': '#fff' }
  });

  map.addLayer({
    id: 'nero-points',
    type: 'circle',
    source: 'nero',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#000',
      'circle-radius': 6
    }
  });

  /* ===== LAYERS BIANCO ===== */
  map.addLayer({
    id: 'clusters-bianco',
    type: 'circle',
    source: 'bianco',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#fff',
      'circle-radius': ['step', ['get', 'point_count'], 15, 10, 20, 30, 25],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#000'
    }
  });

  map.addLayer({
    id: 'cluster-count-bianco',
    type: 'symbol',
    source: 'bianco',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-size': 12
    },
    paint: { 'text-color': '#000' }
  });

  map.addLayer({
    id: 'unclustered-point-bianco',
    type: 'circle',
    source: 'bianco',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#fff',
      'circle-radius': 6,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#000'
    }
  });

  updatePanelHeight();
});

/* =========================
   CLUSTER ZOOM
========================= */
function zoomCluster(e, source) {
  const feature = map.queryRenderedFeatures(e.point, {
    layers: [`clusters-${source}`]
  })[0];

  map.getSource(source).getClusterExpansionZoom(
    feature.properties.cluster_id,
    (err, zoom) => {
      if (!err) {
        map.easeTo({
          center: feature.geometry.coordinates,
          zoom
        });
      }
    }
  );
}

map.on('click', 'clusters-nero', e => zoomCluster(e, 'nero'));
map.on('click', 'clusters-bianco', e => zoomCluster(e, 'bianco'));

/* =========================
   CURSORE
========================= */
[
  'clusters-nero',
  'clusters-bianco',
  'nero-points',
  'unclustered-point-bianco'
].forEach(layer => {
  map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
});

/* =========================
   CLICK PIN
========================= */
map.on('click', 'nero-points', e =>
  updatePanel(e.features[0].properties)
);
map.on('click', 'unclustered-point-bianco', e =>
  updatePanel(e.features[0].properties)
);

/* =========================
   PANEL
========================= */
function updatePanel(properties) {
  const panel = document.getElementById('panel');
  const imgEl = document.getElementById('panel-image');
  const titleEl = document.getElementById('panel-title');
  const descEl = document.getElementById('panel-description');

  panel.classList.remove('panel-empty');

  /* ===== TITOLO ===== */
  titleEl.textContent = properties.name || '';

  /* ===== CONTENUTO HTML ===== */
  let htmlContent = '';

  if (properties.description) {
    if (properties.description.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(properties.description);
        htmlContent = parsed.value || '';
      } catch {
        htmlContent = '';
      }
    } else {
      htmlContent = properties.description;
    }
  }

  /* ===== IMMAGINE ===== */
  let imageUrl = null;

  const imgMatch = htmlContent.match(/<img[^>]+src="([^">]+)"/);
  if (imgMatch && imgMatch[1]) {
    imageUrl = imgMatch[1];
  } else if (properties.gx_media_links) {
    imageUrl = properties.gx_media_links;
  }

  if (imageUrl) {
    imgEl.src =
      'http://localhost:3000/image?url=' +
      encodeURIComponent(imageUrl);
    imgEl.style.display = 'block';
  } else {
    imgEl.style.display = 'none';
  }

  /* ===== DESCRIZIONE ===== */
  let text = '';
  const parts = htmlContent.split(/<br\s*\/?><br\s*\/?>/i);
  if (parts.length > 1) {
    text = parts.slice(1).join(' ');
  }

  text = text
    .replace(/name:\s*/gi, '')
    .replace(/description:\s*/gi, '')
    .trim();

  const tmp = document.createElement('div');
  tmp.innerHTML = text;
  descEl.textContent = tmp.textContent || '';

  updatePanelHeight();
}

/* =========================
   PANEL HEIGHT → MAP
========================= */
function updatePanelHeight() {
  const panel = document.getElementById('panel');
  if (!panel) return;

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

  map.resize();
}

window.addEventListener('resize', updatePanelHeight);
