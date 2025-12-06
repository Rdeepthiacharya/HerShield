import React, { useState, useRef, useEffect } from 'react';
import { 
  View, 
  StyleSheet, 
  Dimensions,
  ActivityIndicator,
  Alert,
  Platform
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';

const { width, height } = Dimensions.get('window');

const WebMapComponent = ({ 
  startLocation, 
  endLocation, 
  routeCoordinates = [],
  userLocation,
  style,
  showUserLocation = false
}) => {
  const webViewRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [currentUserLocation, setCurrentUserLocation] = useState(userLocation);

  // Get user's current location
  useEffect(() => {
    const getLocation = async () => {
      if (showUserLocation) {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const location = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            setCurrentUserLocation({
              latitude: location.coords.latitude,
              longitude: location.coords.longitude
            });
          }
        } catch (error) {
          console.error('Error getting location:', error);
        }
      }
    };
    
    getLocation();
  }, [showUserLocation]);

  // Generate HTML with Leaflet/OpenStreetMap
  const generateMapHTML = () => {
    const startLat = startLocation?.latitude || 12.9716;
    const startLng = startLocation?.longitude || 77.5946;
    const endLat = endLocation?.latitude || 12.9352;
    const endLng = endLocation?.longitude || 77.6245;
    
    // Generate polyline coordinates string
    let polylineCoords = '';
    if (routeCoordinates.length > 0) {
      polylineCoords = routeCoordinates
        .map(coord => `[${coord.latitude}, ${coord.longitude}]`)
        .join(', ');
    }

    // Check if there are any coordinates to center the map
    let centerLat = startLat;
    let centerLng = startLng;
    let zoom = 13;
    
    if (routeCoordinates.length > 0) {
      // Center on the route
      const lats = routeCoordinates.map(c => c.latitude);
      const lngs = routeCoordinates.map(c => c.longitude);
      centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
      zoom = 12;
    } else if (startLocation && endLocation) {
      // Center between start and end
      centerLat = (startLat + endLat) / 2;
      centerLng = (startLng + endLng) / 2;
      zoom = 12;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
          <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
          <style>
              * { margin: 0; padding: 0; }
              body, html { width: 100%; height: 100%; overflow: hidden; background: #f5f5f5; }
              #map { width: 100%; height: 100%; }
              .leaflet-control-zoom { margin-top: 70px !important; }
              .custom-marker { 
                background: #570a1c; 
                width: 24px; 
                height: 24px; 
                border-radius: 50%; 
                border: 3px solid white; 
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
              }
              .start-marker { background: #4CAF50; }
              .end-marker { background: #FF5722; }
              .user-marker { background: #2196F3; }
          </style>
      </head>
      <body>
          <div id="map"></div>
          
          <script>
              // Initialize map
              var map = L.map('map').setView([${centerLat}, ${centerLng}], ${zoom});
              
              // OpenStreetMap tiles
              L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                  attribution: '© OpenStreetMap contributors',
                  maxZoom: 19,
                  minZoom: 3
              }).addTo(map);
              
              // Add markers with custom icons
              var startIcon = L.divIcon({
                  className: 'custom-marker start-marker',
                  html: '<div>S</div>',
                  iconSize: [30, 30],
                  iconAnchor: [15, 15]
              });
              
              var endIcon = L.divIcon({
                  className: 'custom-marker end-marker',
                  html: '<div>D</div>',
                  iconSize: [30, 30],
                  iconAnchor: [15, 15]
              });
              
              var userIcon = L.divIcon({
                  className: 'custom-marker user-marker',
                  html: '<div>U</div>',
                  iconSize: [30, 30],
                  iconAnchor: [15, 15]
              });
              
              // Start marker
              ${startLocation ? `
              L.marker([${startLat}, ${startLng}], {icon: startIcon})
                  .addTo(map)
                  .bindPopup('<b>Start Location</b><br>Your starting point')
                  .openPopup();
              ` : ''}
              
              // End marker
              ${endLocation ? `
              L.marker([${endLat}, ${endLng}], {icon: endIcon})
                  .addTo(map)
                  .bindPopup('<b>Destination</b><br>${endLocation.title || "Your destination"}');
              ` : ''}
              
              // User location marker
              ${currentUserLocation ? `
              L.marker([${currentUserLocation.latitude}, ${currentUserLocation.longitude}], {icon: userIcon})
                  .addTo(map)
                  .bindPopup('<b>Your Location</b><br>Current position');
              ` : ''}
              
              // Add polyline route
              ${routeCoordinates.length > 0 ? `
              var polyline = L.polyline([${polylineCoords}], {
                  color: '#570a1c',
                  weight: 4,
                  opacity: 0.7,
                  lineJoin: 'round',
                  dashArray: '5, 10'
              }).addTo(map);
              
              // Fit map to show entire route
              map.fitBounds(polyline.getBounds(), {padding: [50, 50]});
              ` : ''}
              
              // Make map responsive
              setTimeout(function() {
                  map.invalidateSize();
              }, 100);
              
              // Add controls
              L.control.scale().addTo(map);
              
              // Handle clicks
              map.on('click', function(e) {
                  console.log('Map clicked at:', e.latlng.lat, e.latlng.lng);
              });
              
              console.log('Map initialized with Leaflet/OpenStreetMap');
          </script>
      </body>
      </html>
    `;
  };

  const handleWebViewError = (syntheticEvent) => {
    const { nativeEvent } = syntheticEvent;
    console.error('WebView error: ', nativeEvent);
    Alert.alert('Map Error', 'Unable to load map. Please check your internet connection.');
  };

  const handleWebViewLoad = () => {
    setLoading(false);
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
        style={styles.webview}
        onLoadEnd={handleWebViewLoad}
        onError={handleWebViewError}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        scalesPageToFit={true}
        mixedContentMode="always"
        originWhitelist={['*']}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo={false}
        renderToHardwareTextureAndroid={true}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 15,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(245, 245, 245, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
});

export default WebMapComponent;