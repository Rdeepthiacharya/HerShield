import React, { useState, useRef, useEffect } from 'react';
import { 
  View, 
  StyleSheet, 
  Dimensions,
  ActivityIndicator,
  Alert
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { GEOAPIFY_KEY } from "../utils/config";

const { width, height } = Dimensions.get('window');

const WebMapComponent = ({ 
  startLocation, 
  endLocation, 
  routeCoordinates = [],
  userLocation,
  style,
  showUserLocation = false
}) => {

  // --- STATE ---
  const webViewRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [currentUserLocation, setCurrentUserLocation] = useState(userLocation);
  const [geoRouteCoords, setGeoRouteCoords] = useState([]);

  // --- GET USER LOCATION IF ENABLED ---
  useEffect(() => {
    const fetchLoc = async () => {
      if (!showUserLocation) return;

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;

        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        setCurrentUserLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude
        });
      } catch (error) {
        console.error("User location error:", error);
      }
    };

    fetchLoc();
  }, []);

  // --- FETCH ROUTE FROM GEOAPIFY ---
  useEffect(() => {
    if (startLocation && endLocation) fetchGeoapifyRoute();
  }, [startLocation, endLocation]);

  const fetchGeoapifyRoute = async () => {
    try {
      const url = `https://api.geoapify.com/v1/routing?waypoints=${startLocation.latitude},${startLocation.longitude}|${endLocation.latitude},${endLocation.longitude}&mode=walk&apiKey=${GEOAPIFY_KEY}`;

      const res = await fetch(url);
      const data = await res.json();

      if (!data?.features?.length) return;

      const coords = data.features[0].geometry.coordinates[0].map(([lng, lat]) => ({
        latitude: lat,
        longitude: lng
      }));

      setGeoRouteCoords(coords);

    } catch (err) {
      console.error("Geoapify route error:", err);
    }
  };

  // --- GENERATE HTML FOR WEBVIEW ---
  const generateMapHTML = () => {
    const startLat = startLocation?.latitude || 12.9716;
    const startLng = startLocation?.longitude || 77.5946;
    const endLat = endLocation?.latitude || 12.9352;
    const endLng = endLocation?.longitude || 77.6245;

    const backendCoords = routeCoordinates
      .map(c => `[${c.latitude}, ${c.longitude}]`)
      .join(", ");

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

        <style>
          * { margin: 0; padding: 0; }
          html, body { height: 100%; background: #f5f5f5; }
          #map { width: 100%; height: 100%; }

          .custom-marker { 
            width: 26px;
            height: 26px;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          }
          .start-marker { background: #4CAF50; }
          .end-marker { background: #FF5722; }
          .user-marker { background: #2196F3; }

        </style>
      </head>

      <body>
        <div id="map"></div>

        <script>
          var map = L.map('map').setView([${startLat}, ${startLng}], 13);

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
          }).addTo(map);

          // ICONS
          const startIcon = L.divIcon({ className: "custom-marker start-marker" });
          const endIcon = L.divIcon({ className: "custom-marker end-marker" });
          const userIcon = L.divIcon({ className: "custom-marker user-marker" });

          // --- MARKERS ---

          L.marker([${startLat}, ${startLng}], { icon: startIcon })
            .addTo(map)
            .bindPopup("Start");

          L.marker([${endLat}, ${endLng}], { icon: endIcon })
            .addTo(map)
            .bindPopup("${endLocation?.title || "Destination"}");

          ${currentUserLocation ? `
            L.marker([${currentUserLocation.latitude}, ${currentUserLocation.longitude}], { icon: userIcon })
              .addTo(map)
              .bindPopup("You are here");
          ` : ""}

          // --- GEOAPIFY ROUTE ---
          const geoCoords = ${JSON.stringify(geoRouteCoords)};

          ${geoRouteCoords.length > 0 ? `
            var geoPolyline = L.polyline(
              geoCoords.map(c => [c.latitude, c.longitude]),
              { color: "#1a73e8", weight: 5, opacity: 0.9 }
            ).addTo(map);

            map.fitBounds(geoPolyline.getBounds(), { padding: [40, 40] });
          ` : ""}

          setTimeout(() => map.invalidateSize(), 300);
        </script>
      </body>
      </html>
    `;
  };

  // --- EVENT HANDLERS ---
  const onError = e => {
    console.log("Webview error:", e.nativeEvent);
    Alert.alert("Map Error", "Failed to load map.");
  };

  return (
    <View style={[styles.container, style]}>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#570a1c" />
        </View>
      )}

      <WebView
        ref={webViewRef}
        source={{ html: generateMapHTML() }}
        onLoadEnd={() => setLoading(false)}
        onError={onError}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        originWhitelist={["*"]}
        style={{ flex: 1 }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
    borderRadius: 15,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.8)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  }
});

export default WebMapComponent;
