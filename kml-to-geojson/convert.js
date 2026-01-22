const fs = require('fs');
const { DOMParser } = require('xmldom');

/* =========================
   ARGOMENTI CLI
========================= */
const inputKml = process.argv[2];
const outputGeojson = process.argv[3];

if (!inputKml || !outputGeojson) {
  console.error('Uso: node convert.js input.kml output.geojson');
  process.exit(1);
}

/* =========================
   LETTURA KML
========================= */
const kmlText = fs.readFileSync(inputKml, 'utf8');
const dom = new DOMParser().parseFromString(kmlText, 'text/xml');

/* =========================
   UTILS
========================= */
function getText(node, tag) {
  const el = node.getElementsByTagName(tag)[0];
  return el ? el.textContent.trim() : '';
}

function getExtendedData(node, name) {
  const data = node.getElementsByTagName('Data');
  for (let i = 0; i < data.length; i++) {
    if (data[i].getAttribute('name') === name) {
      const value = data[i].getElementsByTagName('value')[0];
      return value ? value.textContent.trim() : '';
    }
  }
  return '';
}

/* =========================
   CONVERSIONE MANUALE
========================= */
const placemarks = dom.getElementsByTagName('Placemark');

const features = [];

for (let i = 0; i < placemarks.length; i++) {
  const p = placemarks[i];

  const name = getText(p, 'name');
  
  const description = getText(p, 'description');
  const gxMedia = getExtendedData(p, 'gx_media_links');
  const country = getExtendedData(p, 'country');
  const sizeRaw = getExtendedData(p, 'size');

  const size = sizeRaw !== '' ? Number(sizeRaw) : null;

  if (!name || !country || size === null || Number.isNaN(size)) {
    console.warn(
      `⚠️ Placemark ${i + 1} incompleto →`,
      {
        name: name || '(vuoto)',
        country: country || '(mancante)',
        size: sizeRaw || '(mancante)'
      }
    );
  }


  const point = p.getElementsByTagName('Point')[0];
  if (!point) continue;

  const coordsText = getText(point, 'coordinates');
  if (!coordsText) continue;

  const [lon, lat] = coordsText.split(',').map(Number);

  features.push({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [lon, lat]
    },
    properties: {
      name: name || '',
      country: country || '',
      size: size,
      gx_media_links: gxMedia || '',
      description: description || ''
    }

  });
}

/* =========================
   GEOJSON FINALE
========================= */
const geojson = {
  type: 'FeatureCollection',
  features
};

fs.writeFileSync(
  outputGeojson,
  JSON.stringify(geojson, null, 2),
  'utf8'
);

console.log(`✅ Creato ${outputGeojson}`);
