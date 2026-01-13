const fs = require('fs');
const { DOMParser } = require('xmldom');
const toGeoJSON = require('@tmcw/togeojson');

// 1️⃣ leggi KML
const kmlText = fs.readFileSync('bianco.kml', 'utf8');
const dom = new DOMParser().parseFromString(kmlText);

// 2️⃣ converti in GeoJSON
const geojson = toGeoJSON.kml(dom);

// 3️⃣ leggi direttamente i Placemark dal KML
const placemarks = dom.getElementsByTagName('Placemark');

geojson.features.forEach((feature, i) => {
  const pm = placemarks[i];
  if (!pm) return;

  // nome vero
  const nameEl = pm.getElementsByTagName('name')[0];
  if (nameEl) {
    feature.properties.name = nameEl.textContent.trim();
  }

  // descrizione HTML vera
  const descEl = pm.getElementsByTagName('description')[0];
  if (descEl) {
    feature.properties.description = descEl.textContent.trim();
  }
});

// 4️⃣ salva
fs.writeFileSync(
  'bianco.geojson',
  JSON.stringify(geojson, null, 2),
  'utf8'
);

console.log('✅ bianco.geojson creato con name + description reali');

