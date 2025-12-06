import React, { useEffect, useRef, useState } from "react";
import { 
  View, 
  TouchableOpacity, 
  Alert, 
  Text,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Linking
} from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import AppHeader from "../components/AppHeader";
import BottomNav from "../components/BottomNav";
import PageWrapper from "../components/PageWrapper";
import { RouteService } from '../services/RouteService';
import { BASE_URL } from "../utils/config";

const { width, height } = Dimensions.get('window');

export default function MapHomeScreen({ navigation, route }) {
  const webRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [incidentsCount, setIncidentsCount] = useState(0);
  const [incidents, setIncidents] = useState([]);
  const [userId, setUserId] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [destinationName, setDestinationName] = useState("");

  // Check if end point was passed from Search screen
  useEffect(() => {
    if (route.params?.end) {
      setEnd(route.params.end);
      setDestinationName(route.params.locationName || "Destination");
      
      // Send end marker to WebView
      if (webRef.current && mapLoaded) {
        webRef.current.postMessage(
          JSON.stringify({ 
            type: "setEnd", 
            coord: route.params.end 
          })
        );
      }
    }
  }, [route.params]);

  // Updated HTML content with incident markers support
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>HerShield Map</title>
<link href="https://unpkg.com/maplibre-gl@3.4.0/dist/maplibre-gl.css" rel="stylesheet" />
<script src="https://unpkg.com/maplibre-gl@3.4.0/dist/maplibre-gl.js"></script>
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
  #map { width: 100vw; height: 100vh; }
  .maplibregl-control-container { display: none !important; }
  
  /* Custom marker styles */
  .incident-marker {
    background-color: #FF3366;
    border-radius: 50%;
    width: 16px;
    height: 16px;
    border: 2px solid white;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
    cursor: pointer;
    transition: transform 0.2s;
  }
  .incident-marker:hover {
    transform: scale(1.2);
  }
  .incident-marker.verified {
    background-color: #4CAF50;
  }
  .incident-marker.high-severity {
    background-color: #FF0000;
    width: 20px;
    height: 20px;
  }
  .incident-marker.medium-severity {
    background-color: #FF9800;
  }
  .incident-marker.low-severity {
    background-color: #FFEB3B;
  }
  
  .marker-popup {
    max-width: 250px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  }
  .popup-title {
    font-weight: bold;
    margin-bottom: 5px;
    color: #333;
  }
  .popup-details {
    font-size: 14px;
    color: #666;
    margin-bottom: 3px;
  }
  .popup-verified {
    color: #4CAF50;
    font-size: 12px;
    font-weight: bold;
  }
  .popup-time {
    font-size: 12px;
    color: #999;
    margin-top: 5px;
  }
</style>
</head>
<body>
<div id="map"></div>
<script>
  const API_KEY = "01e115490b5549cc9eff64708491d30e";
  let map = new maplibregl.Map({
    container: "map",
    style: "https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=" + API_KEY,
    center: [77.5946, 12.9716],
    zoom: 11,
    attributionControl: false
  });
  
  // Store markers for later reference
  let markers = [];
  let startMarker = null;
  let endMarker = null;
  
  // Function to add incident markers
  function addIncidentMarkers(incidents) {
    console.log('WebView: Adding', incidents?.length, 'incident markers');
    
    // Clear existing incident markers
    markers.forEach(marker => marker.remove());
    markers = [];
    
    if (!incidents || incidents.length === 0) {
      console.log('WebView: No incidents to display');
      return;
    }
    
    incidents.forEach(incident => {
      // Determine marker class based on severity and verification
      let markerClass = "incident-marker";
      if (incident.is_verified) markerClass += " verified";
      if (incident.severity >= 3) markerClass += " high-severity";
      else if (incident.severity === 2) markerClass += " medium-severity";
      else markerClass += " low-severity";
      
      // Create marker element
      const el = document.createElement('div');
      el.className = markerClass;
      el.title = incident.incident_type;
      
      // Create marker
      const marker = new maplibregl.Marker({
        element: el,
        anchor: 'center'
      })
        .setLngLat([incident.longitude, incident.latitude])
        .addTo(map);
      
      // Add click event for popup
      const popup = new maplibregl.Popup({
        offset: 25,
        closeButton: false,
        className: 'marker-popup'
      }).setHTML(\`
        <div class="popup-title">\${incident.incident_type}</div>
        <div class="popup-details">\${incident.description || 'No description'}</div>
        <div class="popup-details">Severity: \${'⚠️'.repeat(incident.severity)}</div>
        <div class="popup-details">Location: \${incident.place_name || 'Unknown location'}</div>
        \${incident.is_verified ? '<div class="popup-verified">✓ Verified</div>' : ''}
        <div class="popup-time">\${incident.relative_time || new Date(incident.created_at).toLocaleDateString()}</div>
      \`);
      
      marker.setPopup(popup);
      markers.push(marker);
    });
    
    console.log('WebView: Successfully added', markers.length, 'incident markers');
  }
  
  // Listen for messages from React Native
  document.addEventListener("message", function(event) {
    console.log('WebView: Received message:', event.data);
    try {
      const msg = JSON.parse(event.data);
      
      if (msg.type === "setStart") {
        console.log('WebView: Setting start marker at', msg.coord);
        if (startMarker) startMarker.remove();
        startMarker = new maplibregl.Marker({ color: "#007BFF" })
          .setLngLat([msg.coord.lng, msg.coord.lat])
          .addTo(map);
        map.flyTo({ center: [msg.coord.lng, msg.coord.lat], zoom: 13 });
      }
      
      if (msg.type === "setEnd") {
        console.log('WebView: Setting end marker at', msg.coord);
        if (endMarker) endMarker.remove();
        endMarker = new maplibregl.Marker({ color: "#FF3366" })
          .setLngLat([msg.coord.lng, msg.coord.lat])
          .addTo(map);
      }
      
      if (msg.type === "addIncidents") {
        console.log('WebView: Adding incidents:', msg.incidents?.length);
        addIncidentMarkers(msg.incidents);
      }
      
      if (msg.type === "clearIncidents") {
        console.log('WebView: Clearing incidents');
        markers.forEach(marker => marker.remove());
        markers = [];
      }
      
      // Send response back to React Native
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ 
            type: "acknowledge", 
            received: msg.type 
          })
        );
      }
      
    } catch (err) {
      console.error("WebView: Error processing message:", err);
    }
  });
  
  // Map click event
  map.on("click", function(e) {
    console.log('WebView: Map clicked at', e.lngLat);
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ 
          type: "mapClick", 
          coord: { lat: e.lngLat.lat, lng: e.lngLat.lng }
        })
      );
    }
  });
  
  // Load incidents when map is ready
  map.on("load", function() {
    console.log('WebView: Map loaded');
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ type: "mapLoaded" })
      );
    }
  });
</script>
</body>
</html>`;

  useEffect(() => {
    loadUserId();
    requestLocation();
    fetchIncidents();
    
    // Set up interval to refresh incidents every 2 minutes
    const interval = setInterval(fetchIncidents, 120000);
    
    return () => clearInterval(interval);
  }, []);

  const loadUserId = async () => {
    try {
      const storedUser = await AsyncStorage.getItem("userData");
      if (storedUser) {
        const userData = JSON.parse(storedUser);
        setUserId(userData.id);
      }
    } catch (error) {
      console.error("Error loading user ID:", error);
    }
  };

  const fetchIncidents = async () => {
    try {
      console.log("Fetching incidents from:", `${BASE_URL}/incidents/recent`);
      
      const response = await fetch(`${BASE_URL}/incidents/recent`);
      
      if (response.ok) {
        const data = await response.json();
        console.log("Incidents API response:", data);
        
        if (data.success && data.incidents) {
          setIncidents(data.incidents);
          setIncidentsCount(data.incidents.length);
          
          // Send incidents to WebView
          if (webRef.current && mapLoaded) {
            console.log("Sending incidents to WebView:", data.incidents.length);
            webRef.current.postMessage(
              JSON.stringify({ 
                type: "addIncidents", 
                incidents: data.incidents 
              })
            );
          } else {
            console.log("WebView not ready yet, incidents will be sent when loaded");
          }
        } else {
          console.log("No incidents found in response");
          // Try fallback to user-specific incidents
          if (userId) {
            fetchUserIncidents();
          }
        }
      } else {
        console.error("Incidents API error status:", response.status);
      }
    } catch (error) {
      console.error("Error fetching incidents:", error);
      // If /incidents/recent doesn't exist, use user reports as fallback
      if (userId) {
        fetchUserIncidents();
      }
    }
  };

  const fetchUserIncidents = async () => {
    try {
      if (!userId) {
        console.log("No user ID for fallback");
        return;
      }
      
      console.log("Fetching user incidents for ID:", userId);
      const response = await fetch(`${BASE_URL}/incident_reports/${userId}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log("User incidents response:", data);
        
        if (data.success && data.reports) {
          setIncidents(data.reports);
          setIncidentsCount(data.count);
          
          if (webRef.current && mapLoaded) {
            webRef.current.postMessage(
              JSON.stringify({ 
                type: "addIncidents", 
                incidents: data.reports 
              })
            );
          }
        }
      }
    } catch (error) {
      console.error("Error fetching user incidents:", error);
    }
  };

  const requestLocation = async () => {
    try {
      setLoading(true);
      
      // Check if permission already granted
      let { status } = await Location.getForegroundPermissionsAsync();
      
      // If not granted, request permission
      if (status !== 'granted') {
        const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
        status = newStatus;
      }
      
      if (status !== 'granted') {
        Alert.alert(
          'Location Permission Required',
          'HerShield needs your location to show safe routes and nearby incidents.',
          [
            {
              text: 'Cancel',
              style: 'cancel',
            },
            {
              text: 'Open Settings',
              onPress: () => Linking.openSettings(),
            },
          ]
        );
        
        // Set default location if permission denied
        const defaultCoord = { lat: 12.9716, lng: 77.5946 };
        setUserLocation(defaultCoord);
        setStart(defaultCoord);
        sendStartLocation(defaultCoord);
        return;
      }

      // Check if location services are enabled
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        Alert.alert(
          'Location Services Disabled',
          'Please enable location services on your device.',
          [
            {
              text: 'Cancel',
              style: 'cancel',
            },
            {
              text: 'Open Settings',
              onPress: () => Linking.openSettings(),
            },
          ]
        );
        
        // Set default location if services disabled
        const defaultCoord = { lat: 12.9716, lng: 77.5946 };
        setUserLocation(defaultCoord);
        setStart(defaultCoord);
        sendStartLocation(defaultCoord);
        return;
      }

      // Get current location with timeout
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        timeout: 10000, // 10 second timeout
      });
      
      const coord = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      console.log("Got user location:", coord);
      setUserLocation(coord);
      setStart(coord);
      sendStartLocation(coord);
      
    } catch (error) {
      console.error("Location error:", error);
      
      if (error.code === 'E_LOCATION_SETTINGS_UNSATISFIED') {
        Alert.alert(
          'Location Error',
          'Location services are not available or inadequate.',
        );
      } else if (error.code === 'E_LOCATION_TIMEOUT') {
        Alert.alert(
          'Location Timeout',
          'Getting your location took too long.',
        );
      }
      
      // Set default location on error
      const defaultCoord = { lat: 12.9716, lng: 77.5946 };
      setUserLocation(defaultCoord);
      setStart(defaultCoord);
      sendStartLocation(defaultCoord);
    } finally {
      setLoading(false);
    }
  };

  const sendStartLocation = (coord) => {
    if (webRef.current && mapLoaded) {
      console.log("Sending start location to WebView:", coord);
      webRef.current.postMessage(
        JSON.stringify({ type: "setStart", coord })
      );
    }
  };

  // NEW FUNCTION: Handle showing safe routes
  const handleShowRoutes = async () => {
    if (!start || !end) {
      Alert.alert("Error", "Please select both start and end points");
      return;
    }

    try {
      setLoading(true);
      
      // Convert coordinates to required format
      const startCoords = { 
        latitude: start.lat, 
        longitude: start.lng 
      };
      const endCoords = { 
        latitude: end.lat, 
        longitude: end.lng 
      };
      
      // Fetch multiple routes using RouteService
      const result = await RouteService.getMultipleRoutes(startCoords, endCoords);
      
      if (result.success && result.routes.length > 0) {
        // Navigate to RouteDetails screen with all routes
        navigation.navigate("RouteDetails", {
          routes: result.routes,
          start: startCoords,
          end: endCoords,
          locationName: destinationName || "Your Destination"
        });
      } else {
        // Fallback to single route if multiple routes not available
        const singleResult = await RouteService.getSingleRoute(startCoords, endCoords);
        
        if (singleResult.success) {
          navigation.navigate("RouteDetails", {
            routes: [singleResult.route], // Wrap in array for compatibility
            start: startCoords,
            end: endCoords,
            locationName: destinationName || "Your Destination"
          });
        } else {
          Alert.alert("Route Error", "Could not find any safe routes to this destination.");
        }
      }
    } catch (error) {
      console.error("Route calculation error:", error);
      Alert.alert("Error", "Failed to calculate routes. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  // NEW FUNCTION: Clear destination
  const handleClearDestination = () => {
    setEnd(null);
    setDestinationName("");
    
    // Clear end marker from WebView
    if (webRef.current && mapLoaded) {
      // We can't directly remove the marker from React Native,
      // but we'll handle it by not showing the route button
    }
    
    Alert.alert("Destination Cleared", "You can select a new destination.");
  };

  const onWebViewMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      console.log("React Native: Received from WebView:", msg.type);
      
      if (msg.type === "mapClick") {
        // Navigate to Search screen with clicked location
        navigation.navigate("Search", { 
          initialLocation: msg.coord,
          startPoint: start 
        });
      }
      
      if (msg.type === "mapLoaded") {
        console.log("React Native: Map loaded");
        setMapLoaded(true);
        
        // Send current location if we have it
        if (userLocation) {
          sendStartLocation(userLocation);
        }
        
        // Send end location if we have it
        if (end) {
          webRef.current.postMessage(
            JSON.stringify({ 
              type: "setEnd", 
              coord: end 
            })
          );
        }
        
        // Send incidents if we have them
        if (incidents.length > 0) {
          console.log("Sending existing incidents to newly loaded map");
          webRef.current.postMessage(
            JSON.stringify({ 
              type: "addIncidents", 
              incidents 
            })
          );
        } else {
          // If no incidents yet, fetch them
          console.log("No incidents yet, fetching...");
          fetchIncidents();
        }
      }
      
      if (msg.type === "acknowledge") {
        console.log("WebView acknowledged:", msg.received);
      }
      
    } catch (err) {
      console.error("React Native: WebView message error:", err);
    }
  };

  const handleRefreshIncidents = async () => {
    setLoading(true);
    await fetchIncidents();
    Alert.alert("Incidents Refreshed", `Loaded ${incidentsCount} incidents in your area`);
    setLoading(false);
  };

  const handleViewIncidentDetails = () => {
    if (incidents.length > 0) {
      // If you have an IncidentList screen
      navigation.navigate("IncidentList", { incidents });
    } else {
      Alert.alert("No Incidents", "No incidents reported in your area yet.");
    }
  };

  return (
    <>
      <AppHeader title="HerShield" />
      <PageWrapper loading={loading} scrollEnabled={false}>
        <View style={{ flex: 1 }}>
          
          {/* Search Bar */}
          <TouchableOpacity 
            onPress={() => navigation.navigate("Search", { startPoint: start })}
            style={styles.searchBar}
            activeOpacity={0.8}
          >
            <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
            <Text style={styles.searchPlaceholder}>
              {end ? destinationName : "Search destination"}
            </Text>
            
            {/* Incident Badge */}
            <TouchableOpacity 
              onPress={handleViewIncidentDetails}
              style={styles.incidentBadgeContainer}
            >
              <View style={styles.incidentBadge}>
                <Text style={styles.incidentBadgeText}>{incidentsCount}</Text>
              </View>
              <Text style={styles.incidentBadgeLabel}>Incidents</Text>
            </TouchableOpacity>
          </TouchableOpacity>

          {/* Current Location Button */}
          <TouchableOpacity 
            onPress={requestLocation}
            style={styles.myLocationButton}
          >
            <Ionicons name="navigate" size={22} color="#ffffff" />
          </TouchableOpacity>

          {/* Refresh Incidents Button */}
          <TouchableOpacity 
            onPress={handleRefreshIncidents}
            style={styles.refreshButton}
          >
            <Ionicons name="refresh" size={22} color="#ffffff" />
          </TouchableOpacity>

          {/* Route Action Button - Only show when destination is selected */}
          {end && (
            <View style={styles.routeButtonsContainer}>
              <TouchableOpacity 
                onPress={handleShowRoutes}
                style={styles.routeButton}
                disabled={loading}
              >
                <Ionicons name="navigate" size={20} color="#fff" />
                <Text style={styles.routeButtonText}>
                  {loading ? "Calculating..." : "Show Safe Routes"}
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                onPress={handleClearDestination}
                style={styles.clearDestinationButton}
              >
                <Ionicons name="close-circle" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {/* Loading Indicator */}
          {loading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color='rgba(139, 19, 62, 0.9)' />
              <Text style={styles.loadingText}>
                {end ? "Finding safe routes..." : "Loading incidents..."}
              </Text>
            </View>
          )}

          {/* Map */}
          <WebView
            ref={webRef}
            source={{ html: htmlContent }}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            style={{ flex: 1 }}
            originWhitelist={["*"]}
            onMessage={onWebViewMessage}
            onError={(error) => console.error("WebView error:", error)}
            onLoadEnd={() => console.log("WebView loaded")}
          />
        </View>
      </PageWrapper>
      <BottomNav active="Map" navigation={navigation} />
    </>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    position: "absolute",
    top: 15,
    left: 15,
    right: 15,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 25,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    zIndex: 1000,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchPlaceholder: {
    flex: 1,
    fontSize: 16,
    color: "#666",
  },
  incidentBadgeContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 10,
  },
  incidentBadge: {
    backgroundColor: 'rgba(139, 19, 62, 0.9)',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 5,
  },
  incidentBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "bold",
  },
  incidentBadgeLabel: {
    fontSize: 12,
    color: "#666",
  },
  myLocationButton: {
    position: "absolute",
    bottom: 100,
    right: 15,
    backgroundColor: 'rgba(139, 19, 62, 0.9)',
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    zIndex: 1000,
  },
  refreshButton: {
    position: "absolute",
    bottom: 160,
    right: 15,
    backgroundColor: 'rgba(139, 19, 62, 0.9)',
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    zIndex: 1000,
  },
  routeButtonsContainer: {
    position: "absolute",
    bottom: 160,
    left: 15,
    right: 15,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 1000,
  },
  routeButton: {
    flex: 1,
    backgroundColor: "#007BFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 15,
    borderRadius: 25,
    elevation: 5,
    shadowColor: "#007BFF",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    marginRight: 10,
  },
  routeButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  clearDestinationButton: {
    backgroundColor: "#FF3366",
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
    shadowColor: "#FF3366",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: 'rgba(139, 19, 62, 0.9)',
  },
});