mapboxgl.accessToken = window.MAPBOX_TOKEN;

const DEFAULT_ZOOM = 3.5;

const STARTUP_REGIONS = [

  {
    id: "SOUTH_CENTRAL_EUROPE",
    name: "South-Central Europe",
    center: [11.4041, 47.2692]
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

});

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