mapboxgl.accessToken = window.MAPBOX_TOKEN;

const DEFAULT_ZOOM = 3.5;

const STARTUP_REGIONS = [

  {
    name: "South-Central Europe",
    center: [11.40, 47.27]
  },

  {
    name: "Northern Europe",
    center: [9.22, 61.46]
  },

  {
    name: "Middle East",
    center: [44.53, 36.88]
  },

  {
    name: "Arabic Peninsula",
    center: [48.21, 22.79]
  },

  {
    name: "Central Asia",
    center: [69.24, 41.31]
  },

  {
    name: "European Russia",
    center: [53.50, 59.26]
  },

  {
    name: "Siberia",
    center: [116.29, 59.61]
  },

  {
    name: "East Asia",
    center: [132.99, 37.02]
  },

  {
    name: "Northern China",
    center: [101.64, 40.79]
  },

  {
    name: "Southern China",
    center: [109.35, 28.83]
  },

  {
    name: "Indian Subcontinent",
    center: [78.88, 25.48]
  },

  {
    name: "Indian Islands",
    center: [78.30, 10.24]
  },

  {
    name: "South-East Asia",
    center: [104.39, 11.57]
  },

  {
    name: "Indonesia",
    center: [116.90, -1.93]
  },

  {
    name: "Western Australia",
    center: [129.23, -23.23]
  },

  {
    name: "Eastern Australia",
    center: [143.31, -31.80]
  },

  {
    name: "New Zealand",
    center: [172.60, -41.86]
  },

  {
    name: "Pacific Islands",
    center: [176.83, -14.71]
  },

  {
    name: "Hawaii",
    center: [-157.86, 21.31]
  },

  {
    name: "Southern Africa",
    center: [28.86, -23.53]
  },

  {
    name: "Central Africa",
    center: [27.98, -1.92]
  },

  {
    name: "Horn of Africa",
    center: [40.28, 7.28]
  },

  {
    name: "Eastern Sahara",
    center: [27.58, 22.68]
  },

  {
    name: "Western Sahara",
    center: [-0.72, 28.62]
  },

  {
    name: "Subsaharian Africa",
    center: [2.11, 13.51]
  },

  {
    name: "Azores",
    center: [-25.67, 37.74]
  },

  {
    name: "Greenland",
    center: [-45.00, 69.00]
  },

  {
    name: "New England",
    center: [-71.72, 44.22]
  },

  {
    name: "Eastern US",
    center: [-86.60, 36.06]
  },

  {
    name: "Western US",
    center: [-104.99, 39.74]
  },

  {
    name: "Western Canada",
    center: [-110.00, 57.00]
  },

  {
    name: "Alaska",
    center: [-140.00, 65.00]
  },

  {
    name: "Mexico",
    center: [-98.93, 22.58]
  },

  {
    name: "Caribbean",
    center: [-76.04, 15.86]
  },

  {
    name: "Northern Amazon",
    center: [-70.00, 1.00]
  },

  {
    name: "Andes",
    center: [-67.96, -11.40]
  },

  {
    name: "Central Brazil",
    center: [-48.50, -11.00]
  },

  {
    name: "Pampas",
    center: [-55.32, -26.74]
  },

  {
    name: "Patagonia",
    center: [-63.78, -44.87]
  },

  {
    name: "Antarctic Peninsula",
    center: [-58.00, -64.90]
  }

];

let currentIndex = 0;

function updatePanelScale() {

  const panel =
    document.getElementById("footer");

  if (!panel) return;

  const n = 5;
  const gap = 10;
  const sidePadding = 20;

  const baseW = 380;
  const baseH = 280;

  const available =
    panel.clientWidth - sidePadding;

  const maxCardW =
    (available - gap * (n - 1)) / n;

  const scale =
    Math.min(1, maxCardW / baseW);

  document.documentElement.style.setProperty(
    "--card-w",
    `${baseW * scale}px`
  );

  document.documentElement.style.setProperty(
    "--card-h",
    `${baseH * scale}px`
  );

  document.documentElement.style.setProperty(
    "--card-scale",
    scale.toFixed(3)
  );

}

updatePanelScale();

window.addEventListener(
  "resize",
  updatePanelScale
);

const map = new mapboxgl.Map({

  container: "map",

  style: "mapbox://styles/pingeo/cmle3qgj100br01s9fgb3gbo3",

  center: STARTUP_REGIONS[0].center,

  zoom: DEFAULT_ZOOM,

  projection: "globe"

});

map.addControl(
  new mapboxgl.NavigationControl(),
  "top-left"
);

map.on("load", () => {

  showRegion(currentIndex);

  updateCenterCoordinates();

});

map.on(
  "moveend",
  updateCenterCoordinates
);

function showRegion(index) {

  const region =
    STARTUP_REGIONS[index];

  document.getElementById("region-name").textContent =
    region.name;

  document.getElementById("region-coords").textContent =
    `${region.center[1].toFixed(4)}, ${region.center[0].toFixed(4)}`;

  document.getElementById("counter").textContent =
    `${index + 1} / ${STARTUP_REGIONS.length}`;

  map.flyTo({

    center: region.center,

    zoom: DEFAULT_ZOOM,

    duration: 800

  });

}

function updateCenterCoordinates() {

  const center =
    map.getCenter();

  document.getElementById("region-coords").textContent =
    `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;

}

document.getElementById("prev-btn").addEventListener("click", () => {

  currentIndex--;

  if (currentIndex < 0)
    currentIndex = STARTUP_REGIONS.length - 1;

  showRegion(currentIndex);

});

document.getElementById("next-btn").addEventListener("click", () => {

  currentIndex++;

  if (currentIndex >= STARTUP_REGIONS.length)
    currentIndex = 0;

  showRegion(currentIndex);

});