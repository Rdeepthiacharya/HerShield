import React, {forwardRef, useImperativeHandle, useRef,} from "react";
import { View, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import karnatakaGeoJSON from "../services/karnataka.json";
import { GEOAPIFY_KEY } from "../utils/config";

const WebMapComponent = forwardRef(({ onMapMessage }, ref) => {
  const webViewRef = useRef(null);

  useImperativeHandle(ref, () => ({
    centerMap: (lat, lng) => sendMessage("CENTER_MAP", { lat, lng }),
  
    showCurrentLocation: (lat, lng) =>
      sendMessage("SHOW_CURRENT_LOCATION", { lat, lng }),
  
    resetToKarnataka: () => sendMessage("RESET_TO_KARNATAKA"),
  
    setStart: (lat, lng) =>
      sendMessage("SET_START", { lat, lng }),
  
    setEnd: (lat, lng) =>
      sendMessage("SET_END", { lat, lng }),
  
    addIncidents: (incidents) =>
      sendMessage("ADD_INCIDENTS", { incidents }),
  
    clearIncidents: () =>
      sendMessage("CLEAR_INCIDENTS"),

    showRoutes: (routes) =>
      sendMessage("SHOW_ROUTES", { routes }),
  
    highlightRoute: (index) =>
      sendMessage("HIGHLIGHT_ROUTE", { index }),

    fitRoute: (coords) =>
      sendMessage("FIT_ROUTE", { coords }),
  }));
  
  const sendMessage = (type, payload) => {
    webViewRef.current?.postMessage(
      JSON.stringify({ type, payload })
    );
  };

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link href="https://unpkg.com/maplibre-gl@3.4.0/dist/maplibre-gl.css" rel="stylesheet"/>
<script src="https://unpkg.com/maplibre-gl@3.4.0/dist/maplibre-gl.js"></script>
<style>
html, body, #map {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
}
.ring-marker {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(194, 169, 186, 0.3);  
  border: 5px solid #7b0f2b;  
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 14px rgba(0,0,0,0.35);
}
.ring-marker-inner {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background:rgba(0, 0, 0, 0);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ring-marker-inner svg {
  width: 22px;
  height: 22px;
  fill: #7b0f2b;
}
</style>
</head>

<body>
<div id="map"></div>

<script>
window.ReactNativeWebView.postMessage(
  JSON.stringify({ type: "JS_STARTED" })
);

const API_KEY = "${GEOAPIFY_KEY}";
const KA = ${JSON.stringify(karnatakaGeoJSON)};

let map;
let currentMarker = null;
let startMarker = null;
let endMarker = null;
let incidentMarkers = [];
let routeLayers = [];

const KA_BOUNDS = [
  [74.0, 11.5],   // SW
  [78.6, 18.45]   // NE
];

function handleMessage(event) {
  try {
    const msg = JSON.parse(event.data);

    switch (msg.type) {

      case "CENTER_MAP":
      map.flyTo({
        center: [msg.payload.lng, msg.payload.lat],
        zoom: 18, // 🔥 increase zoom
        pitch: 60, // 🔥 tilt camera
        bearing: 0, // later we rotate
        speed: 1.2
      });
      break;

      case "SHOW_CURRENT_LOCATION":
        showCurrentLocation(msg.payload.lat, msg.payload.lng);
        break;

      case "RESET_TO_KARNATAKA":
        map.fitBounds(KA_BOUNDS, {
          padding: 60,
          duration: 1000
        });
        break;

      case "SET_START":
        setStart(msg.payload.lat, msg.payload.lng);
        break;

      case "SET_END":
        setEnd(msg.payload.lat, msg.payload.lng);
        break;

      case "ADD_INCIDENTS":
        addIncidents(msg.payload.incidents);
        break;

      case "CLEAR_INCIDENTS":
        clearIncidents();
        break;

      case "SHOW_ROUTES":
        drawRoutes(msg.payload.routes);
        break;

      case "HIGHLIGHT_ROUTE":
        highlightRoute(msg.payload.index);
        break;

      case "FIT_ROUTE":
        fitRoute(msg.payload.coords);
        break;  


      default:
        console.log("Unknown message type:", msg.type);
    }

  } catch (e) {
    console.log("Message parse error", e);
  }
}
document.addEventListener("message", handleMessage);
window.addEventListener("message", handleMessage);

function buildMaskPolygon(kaGeo) {
  const world = [
    [-180, -90], [180, -90], [180, 90],
    [-180, 90], [-180, -90]
  ];

  const holes = [];

  kaGeo.features.forEach(f => {
    if (f.geometry.type === "Polygon") {
      holes.push(...f.geometry.coordinates);
    }
    if (f.geometry.type === "MultiPolygon") {
      f.geometry.coordinates.forEach(p => {
        holes.push(...p);
      });
    }
  });

  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [world, ...holes]
    }
  };
}

function fitRoute(coords) {
  if (!coords || coords.length === 0) return;

  const bounds = new maplibregl.LngLatBounds();

  coords.forEach(c => bounds.extend(c));

  map.fitBounds(bounds, {
    padding: 60,
    duration: 1000
  });
}

map = new maplibregl.Map({
  container: "map",
 // style: "https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=" + API_KEY,
  style: "https://maps.geoapify.com/v1/styles/klokantech-basic/style.json?apiKey=" + API_KEY,
  center: [76.5, 15.0],
  zoom: 5,
  attributionControl: false
});

map.on("load", () => {

  map.addSource("mask", {
    type: "geojson",
    data: buildMaskPolygon(KA)
  });

  map.on("error", (e) => {
  setTimeout(() => {
    window.ReactNativeWebView.postMessage(
      JSON.stringify({ type: "MAP_READY" })
    );
  }, 0);
});

map.on("dragstart", () => {
  window.ReactNativeWebView.postMessage(
    JSON.stringify({ type: "MAP_DRAG" })
  );
});

  map.addLayer({
    id: "mask-layer",
    type: "fill",
    source: "mask",
    paint: {
      "fill-color": "rgba(0,0,0,0.45)"
    }
  });

  map.addSource("karnataka", {
    type: "geojson",
    data: KA
  });

  map.addLayer({
    id: "ka-fill",
    type: "fill",
    source: "karnataka",
    paint: {
      "fill-color": "rgba(76,175,80,0.15)"
    }
  });

  map.addLayer({
    id: "ka-border",
    type: "line",
    source: "karnataka",
    paint: {
      "line-color": "#4CAF50",
      "line-width": 3
    }
  });

  window.ReactNativeWebView.postMessage(
    JSON.stringify({ type: "MAP_READY" })
  );
});

function createRingMarker(color = "#7b0f2b") {
  const outer = document.createElement("div");
  outer.className = "ring-marker";
  outer.style.borderColor = color;

  const inner = document.createElement("div");
  inner.className = "ring-marker-inner";

  inner.innerHTML =
    '<svg viewBox="0 0 24 24">' +
      '<path fill="' + color + '" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/>' +
    '</svg>';

  outer.appendChild(inner);
  return outer;
}


function showCurrentLocation(lat, lng) {
  // Remove previous live marker completely
  if (currentMarker) {
    currentMarker.remove();
    currentMarker = null;
  }

  const markerEl = createRingMarker("#7b0f2b");

  currentMarker = new maplibregl.Marker({
    element: markerEl,
    anchor: "center"
  })
    .setLngLat([lng, lat])
    .addTo(map);

  // Attach popup ONLY to marker (NOT directly to map)
  const popup = new maplibregl.Popup({
    offset: 25,
    closeButton: true,
    closeOnClick: false
  }).setHTML(
    '<div style="font-size:13px;"><b>📍 You are here</b></div>'
  );

  currentMarker.setPopup(popup);

  // Open popup without creating duplicate visual anchor
  currentMarker.togglePopup();

  map.flyTo({
    center: [lng, lat],
    zoom: 16,
    speed: 1.2
  });
}

map.on("click", (e) => {
  window.ReactNativeWebView.postMessage(
    JSON.stringify({
      type: "mapClick",
      coord: { lat: e.lngLat.lat, lng: e.lngLat.lng }
    })
  );
});




function setStart(lat, lng) {
  if (startMarker) startMarker.remove();

  startMarker = new maplibregl.Marker({
    element: createRingMarker("#2E7DFF"), // blue
    anchor: "center"
  })
    .setLngLat([lng, lat])
    .addTo(map);
}

function setEnd(lat, lng) {
  if (endMarker) endMarker.remove();

  endMarker = new maplibregl.Marker({
    element: createRingMarker("#D32F2F"), // red
    anchor: "center"
  })
    .setLngLat([lng, lat])
    .addTo(map);
}

function clearIncidents() {
  incidentMarkers.forEach(m => m.remove());
  incidentMarkers = [];
}
function addIncidents(incidents) {
  clearIncidents();

  incidents.forEach(i => {
    // 🔥 NORMALIZE BACKEND FIELDS (CRITICAL)
    const lat = parseFloat(i.latitude ?? i.lat);
    const lng = parseFloat(i.longitude ?? i.lng);

    if (!lat || !lng) return; // skip invalid rows

    const el = document.createElement("div");
    el.style.width = "14px";
    el.style.height = "14px";
    el.style.borderRadius = "50%";
    el.style.background =
      i.severity >= 3 ? "#D32F2F" :
      i.severity === 2 ? "#FF9800" :
      "#FBC02D";

    // 🔥 USE YOUR DB FIELDS DIRECTLY
    const popupHtml =
      '<div style="font-size:13px; max-width:220px;">' +
        '<b>' + (i.incident_type || "Safety Report") + '</b><br/>' +
        (i.description || "No description provided") + '<br/>' +
        (i.place_name ? '<small>📍 ' + i.place_name + '</small>' : '') +
      '</div>';

    const popup = new maplibregl.Popup({ offset: 18 })
      .setHTML(popupHtml);

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([lng, lat]) // ← FIXED parsing
      .setPopup(popup)
      .addTo(map);

    incidentMarkers.push(marker);
  });
}
  
/* ---------- ROUTES ---------- */

function clearRoutes() {
  routeLayers.forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  });
  routeLayers = [];
}

function drawRoutes(routes) {
  clearRoutes();

  routes.forEach((route, index) => {
    drawRoute(route, index, route.color || "#4CAF50");
  });

  // Auto highlight first route
  highlightRoute(0);
}

function drawRoute(route, index, color) {
  const id = "route-" + index;

  const coords = route.coords;

  map.addSource(id, {
    type: "geojson",
    data: {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: coords
      }
    }
  });

  map.addLayer({
    id,
    type: "line",
    source: id,
    layout: {
      "line-cap": "round",
      "line-join": "round"
    },
    paint: {
      "line-color": color,
      "line-width": 5,
      "line-opacity": 0.6
    }
  });

  routeLayers.push(id);
}

function highlightRoute(index) {
  routeLayers.forEach((id, i) => {
    if (!map.getLayer(id)) return;

    map.setPaintProperty(id, "line-width", i === index ? 7 : 4);
    map.setPaintProperty(id, "line-opacity", i === index ? 1 : 0.35);
  });
}
</script>

</body>
</html>`;

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html }}
        onMessage={onMapMessage}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={["*"]}
      />
    </View>
  );
});

export default WebMapComponent;

const styles = StyleSheet.create({
  container: { flex: 1 },
});
