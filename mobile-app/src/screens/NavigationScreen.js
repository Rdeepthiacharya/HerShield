import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Alert,
  StatusBar,
  Modal,
  ScrollView,
  Platform,
  ActivityIndicator,
  SafeAreaView
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { useToast } from "../context/ToastContext";
import { BASE_URL } from "../utils/config";
import { GEOAPIFY_KEY } from "../utils/config";
const { width, height } = Dimensions.get('window');


// Navigation Service
class NavigationService {
  constructor(routes, onUpdate) {
    console.log("NavigationService initialized with routes:", routes?.length || 0);

    this.routes = this.validateAndFormatRoutes(routes || []);
    this.selectedRouteIndex = 0;
    this.currentRoute = this.routes?.[0] || null;
    this.onUpdate = onUpdate;
    this.isNavigating = false;
    this.currentPosition = null;
    this.currentStepIndex = 0;
    this.routeProgress = 0;
    this.locationSubscription = null;
  }

  validateAndFormatRoutes(routes) {
    if (!routes || routes.length === 0) {
      console.log("No routes provided");
      return [];
    }

    return routes.map((route, index) => ({
      ...route,
      type: route.type || `Route ${index + 1}`,
      color: route.color || (index === 0 ? '#4CAF50' : '#4A0D35'),
      distance: route.distance || 0,
      duration: route.duration || 0,
      total_risk: route.total_risk || 0,
      coords: this.formatCoordinates(route.coords || [])
    }));
  }

  formatCoordinates(coords) {
    if (!coords || !Array.isArray(coords)) return [];

    return coords.map((coord) => {
      const lat = coord.latitude || coord.lat;
      const lng = coord.longitude || coord.lng;

      if (lat === undefined || lng === undefined) return null;

      return {
        latitude: parseFloat(lat),
        longitude: parseFloat(lng),
        risk: coord.risk || false
      };
    }).filter(coord => coord !== null);
  }

  async startNavigation() {
    if (this.isNavigating) return;

    try {
      const { requestForegroundPermissionsAsync, getCurrentPositionAsync, watchPositionAsync } = await import('expo-location');

      const { status } = await requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        this.onUpdate?.({
          type: 'gps_error',
          error: 'Location permission not granted'
        });
        return;
      }

      const initialLocation = await getCurrentPositionAsync({ accuracy: 6 });

      this.currentPosition = {
        latitude: initialLocation.coords.latitude,
        longitude: initialLocation.coords.longitude,
        accuracy: initialLocation.coords.accuracy,
        speed: initialLocation.coords.speed || 0,
        timestamp: new Date().toISOString()
      };

      this.isNavigating = true;
      this.watchPosition();
      this.updateNavigation();

    } catch (error) {
      this.onUpdate?.({
        type: 'gps_error',
        error: error.message
      });
    }
  }

  async watchPosition() {
    try {
      const { watchPositionAsync } = await import('expo-location');

      if (this.locationSubscription) {
        this.locationSubscription.remove();
      }

      this.locationSubscription = await watchPositionAsync(
        {
          accuracy: 6,
          distanceInterval: 5,
          timeInterval: 1000,
        },
        (position) => {
          this.currentPosition = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed || 0,
            timestamp: new Date().toISOString()
          };
          this.updateNavigation();
        }
      );

    } catch (error) {
      this.onUpdate?.({
        type: 'gps_error',
        error: 'Failed to watch position: ' + error.message
      });
    }
  }

  calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const φ1 = this.toRad(lat1);
    const φ2 = this.toRad(lat2);
    const Δφ = this.toRad(lat2 - lat1);
    const Δλ = this.toRad(lon2 - lon1);

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  updateNavigation() {
    if (!this.currentPosition || !this.currentRoute?.coords || this.currentRoute.coords.length === 0) {
      this.onUpdate?.({
        type: 'route_error',
        error: 'No route coordinates available'
      });
      return;
    }

    const routeCoords = this.currentRoute.coords;

    let nearestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < routeCoords.length; i++) {
      const coord = routeCoords[i];
      const distance = this.calculateHaversineDistance(
        this.currentPosition.latitude,
        this.currentPosition.longitude,
        coord.latitude,
        coord.longitude
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestIndex = i;
      }
    }

    this.currentStepIndex = nearestIndex;
    const isOffRoute = minDistance > 50;
    const progress = routeCoords.length > 1 ?
      Math.min(100, Math.max(0, (nearestIndex / (routeCoords.length - 1)) * 100)) : 0;
    this.routeProgress = progress;

    const steps = this.calculateSteps(routeCoords);
    let currentStep = null;
    let nextStep = null;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (nearestIndex >= step.startIndex) {
        currentStep = step;
        nextStep = steps[i + 1];
      } else {
        break;
      }
    }

    if (!currentStep && steps.length > 0) {
      currentStep = steps[0];
      nextStep = steps[1];
    }

    let distanceToNext = 0;
    if (nextStep && currentStep && routeCoords[nearestIndex]) {
      const nextStepCoord = routeCoords[nextStep.startIndex];
      distanceToNext = this.calculateHaversineDistance(
        this.currentPosition.latitude,
        this.currentPosition.longitude,
        nextStepCoord.latitude,
        nextStepCoord.longitude
      );
    }

    const updateData = {
      type: isOffRoute ? 'off_route' : 'step_updated',
      currentStep: currentStep,
      nextStep: nextStep,
      progress: progress,
      distanceToNext: distanceToNext,
      isOffRoute: isOffRoute,
      currentPosition: this.currentPosition,
      routeInfo: {
        distance: this.currentRoute.distance,
        duration: this.currentRoute.duration,
        totalRisk: this.currentRoute.total_risk,
        type: this.currentRoute.type
      }
    };

    this.onUpdate?.(updateData);

    if (nearestIndex >= routeCoords.length - 1 && progress >= 99) {
      this.onUpdate?.({
        type: 'destination_reached',
        currentStep: {
          type: 'destination',
          text: 'You have reached your destination'
        }
      });
    }
  }

  calculateSteps(coords) {
    if (!coords || coords.length < 2) return [];

    return [
      {
        type: 'start',
        text: 'Start navigation',
        coordinate: coords[0],
        startIndex: 0,
        endIndex: 0
      },
      {
        type: 'destination',
        text: 'Arrive at destination',
        coordinate: coords[coords.length - 1],
        startIndex: coords.length - 1,
        endIndex: coords.length - 1
      }
    ];
  }

  toRad(degrees) {
    return degrees * Math.PI / 180;
  }

  switchRoute(routeIndex) {
    if (routeIndex >= 0 && routeIndex < this.routes.length) {
      this.selectedRouteIndex = routeIndex;
      this.currentRoute = this.routes[routeIndex];
      this.currentStepIndex = 0;
      this.routeProgress = 0;

      this.onUpdate?.({
        type: 'route_changed',
        route: this.currentRoute,
        selectedIndex: routeIndex
      });

      this.updateNavigation();
      return true;
    }
    return false;
  }

  getCurrentRoute() {
    return this.currentRoute;
  }

  getAllRoutes() {
    return this.routes;
  }

  stopNavigation() {
    if (this.locationSubscription) {
      this.locationSubscription.remove();
      this.locationSubscription = null;
    }
    this.isNavigating = false;
    this.currentPosition = null;
  }

  pauseNavigation() {
    if (this.locationSubscription) {
      this.locationSubscription.remove();
      this.locationSubscription = null;
    }
    this.isNavigating = false;
  }

  resumeNavigation() {
    if (!this.isNavigating) {
      this.isNavigating = true;
      this.watchPosition();
    }
  }
}

export default function NavigationScreen({ navigation, route }) {
  const { routes: routeData, start, end, locationName } = route.params || {};
  const webRef = useRef(null);
  const [navigationService, setNavigationService] = useState(null);
  const { showToast } = useToast();
  const [currentStep, setCurrentStep] = useState(null);
  const [nextStep, setNextStep] = useState(null);
  const [progress, setProgress] = useState(0);
  const [distanceToNext, setDistanceToNext] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [showRouteOptions, setShowRouteOptions] = useState(false);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [currentPosition, setCurrentPosition] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [allRoutes, setAllRoutes] = useState([]);

  useEffect(() => {
    if (routeData && routeData.length > 0) {
      setAllRoutes(routeData);
    } else {
      showToast("No route data was provided. Please go back and try again", "error");
      setTimeout(() => navigation.goBack(), 2000);
    }
  }, [routeData]);

  useEffect(() => {
    if (allRoutes.length > 0) {
      initializeNavigation();
    }
  }, [allRoutes]);

  useEffect(() => {
    return () => {
      if (navigationService) {
        navigationService.stopNavigation();
      }
    };
  }, [navigationService]);

  useEffect(() => {
    if (mapReady && navigationService) {
      updateMapRoute();
    }
  }, [mapReady, navigationService]);

  const initializeNavigation = () => {
    const navService = new NavigationService(
      allRoutes,
      (navUpdate) => {
        if (navUpdate.type === 'step_updated' || navUpdate.type === 'route_changed') {
          setCurrentStep(navUpdate.currentStep);
          setNextStep(navUpdate.nextStep);
          setProgress(navUpdate.progress);
          setDistanceToNext(navUpdate.distanceToNext || 0);
          if (navUpdate.currentPosition) {
            setCurrentPosition(navUpdate.currentPosition);
          }

          if (webRef.current && mapReady) {
            updateMapRoute();
          }
        }

        if (navUpdate.type === 'off_route') {
          showToast("You have strayed from the route", "warning");
          Alert.alert(
            "Off Route",
            `You have strayed from the route.`,
            [
              { text: "Recalculate", onPress: () => recalculateRoute() },
              { text: "Continue Anyway", style: "cancel" }
            ]
          );
        }

        if (navUpdate.type === 'destination_reached') {
          showToast("You have safely reached your destination!", "success");
          Alert.alert(
            "Arrived at Destination",
            "You have safely reached your destination!",
            [{ text: "OK", onPress: () => navigation.goBack() }]
          );
        }

        if (navUpdate.type === 'gps_error') {
          showToast(navUpdate.error || "Unable to get your location", "error");
          Alert.alert(
            "GPS Error",
            navUpdate.error || "Unable to get your location",
            [{ text: "OK" }]
          );
        }
      }
    );

    setNavigationService(navService);
    navService.startNavigation();
  };

  const updateMapRoute = () => {
    if (!navigationService || !navigationService.getCurrentRoute()) return;

    const route = navigationService.getCurrentRoute();

    if (!route.coords || route.coords.length === 0) return;

    const allAvailableRoutes = navigationService.getAllRoutes();

    const routePoints = route.coords.map(coord => ({
      lat: coord.latitude,
      lng: coord.longitude
    }));

    const alternativeRoutes = allAvailableRoutes
      .filter((r, index) => index !== navigationService.selectedRouteIndex)
      .slice(0, 2)
      .map(r => ({
        coords: (r.coords || []).map(c => ({
          lat: c.latitude,
          lng: c.longitude
        })),
        distance: r.distance,
        duration: r.duration,
        total_risk: r.total_risk,
        type: r.type || `Route ${allAvailableRoutes.indexOf(r) + 1}`,
        color: r.color || '#FFC107'
      }));

    const message = {
      type: "updateRoute",
      route: routePoints,
      currentPosition: currentPosition ? {
        lat: currentPosition.latitude,
        lng: currentPosition.longitude
      } : null,
      showAlternativeRoutes: alternativeRoutes.length > 0,
      alternativeRoutes: alternativeRoutes,
      selectedRouteIndex: navigationService.selectedRouteIndex,
      routeColor: route.color || '#007BFF'
    };

    if (webRef.current) {
      webRef.current.postMessage(JSON.stringify(message));
    }
  };

  const switchRoute = (index) => {
    if (navigationService) {
      const success = navigationService.switchRoute(index);
      if (success) {
        setSelectedRouteIndex(index);
        setShowRouteOptions(false);

        if (webRef.current && mapReady) {
          updateMapRoute();
        }
      }
    }
  };

  const recalculateRoute = async () => {
    setRecalculating(true);
    await fetchNewRoutes();
  };

  const fetchNewRoutes = async () => {
    try {
      setRecalculating(true);

      if (!start || !end) {
        showToast("Start and end points are required", "error");
        return;
      }

      const response = await fetch(`${BASE_URL}/safe_route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: start,
          end: end
        })
      });

      const data = await response.json();

      if (data.success && data.routes && data.routes.length > 0) {
        const newRoutes = data.routes;
        setAllRoutes(newRoutes);

        if (navigationService) {
          navigationService.stopNavigation();
        }

        setSelectedRouteIndex(0);
        setProgress(0);
        setCurrentStep(null);
        setNextStep(null);
        setDistanceToNext(0);

        if (webRef.current && mapReady) {
          webRef.current.postMessage(JSON.stringify({ type: "clearRoutes" }));
        }

        setShowRouteOptions(true);
        showToast(`${newRoutes.length} route options available`, "success");
      } else {
        showToast("Could not find alternative routes", "error");
      }
    } catch (error) {
      console.error("Recalculation error:", error);
      showToast("Failed to recalculate routes", "error");
    } finally {
      setRecalculating(false);
    }
  };

  const togglePause = () => {
    setIsPaused(!isPaused);
    if (navigationService) {
      if (isPaused) {
        navigationService.resumeNavigation();
      } else {
        navigationService.pauseNavigation();
      }
    }
  };

  const stopNavigation = () => {
    if (navigationService) {
      navigationService.stopNavigation();
    }
    navigation.goBack();
  };

  const getDistanceText = (meters) => {
    if (!meters || meters < 1) return "0 m";
    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
  };

  const getTurnIcon = (type) => {
    switch (type) {
      case 'start': return 'play';
      case 'left': return 'arrow-back';
      case 'right': return 'arrow-forward';
      case 'slight-left': return 'return-up-left';
      case 'slight-right': return 'return-up-right';
      case 'uturn': return 'sync';
      case 'destination': return 'flag';
      case 'straight': return 'arrow-forward';
      default: return 'arrow-forward';
    }
  };

  const getRiskColor = (riskScore) => {
    if (riskScore === 0) return '#4CAF50';
    if (riskScore <= 2) return '#FFC107';
    return '#F44336';
  };

  const getRiskText = (riskScore) => {
    if (riskScore === 0) return 'Safest';
    if (riskScore <= 2) return 'Moderate';
    return 'Risky';
  };

  const RouteOptionItem = ({ route, index, isSelected, onSelect }) => (
    <TouchableOpacity
      style={[
        styles.routeOption,
        isSelected && styles.selectedRouteOption
      ]}
      onPress={() => onSelect(index)}
      activeOpacity={0.7}
    >
      <View style={[
        styles.routeIconContainer,
        { borderColor: isSelected ? route.color || '#4CAF50' : '#e0e0e0' }
      ]}>
        <View style={[
          styles.routeIcon,
          { backgroundColor: route.color || '#4CAF50' }
        ]} />
      </View>

      <View style={styles.routeDetails}>
        <View style={styles.routeHeader}>
          <View style={styles.routeTitleContainer}>
            <Text style={styles.routeType} numberOfLines={1}>
              {route.type || `Route ${index + 1}`}
            </Text>
            {isSelected && (
              <View style={styles.selectedIndicator}>
                <Text style={styles.selectedText}>Selected</Text>
              </View>
            )}
          </View>
          <View style={[
            styles.riskBadgeSmall,
            { backgroundColor: getRiskColor(route.total_risk || 0) }
          ]}>
            <Text style={styles.riskTextSmall}>
              {getRiskText(route.total_risk || 0)}
            </Text>
          </View>
        </View>

        <View style={styles.routeStatsRow}>
          <View style={styles.statItem}>
            <Ionicons name="walk-outline" size={16} color="#666" />
            <Text style={styles.statText}>{route.distance || 0} km</Text>
          </View>
          <View style={styles.statItem}>
            <Ionicons name="time-outline" size={16} color="#666" />
            <Text style={styles.statText}>{route.duration || 0} min</Text>
          </View>
          <View style={styles.statItem}>
            <Ionicons name="warning-outline" size={16} color="#666" />
            <Text style={styles.statText}>{route.total_risk || 0} risks</Text>
          </View>
        </View>
      </View>

      {isSelected && (
        <Ionicons name="checkmark-circle" size={24} color="#4A0D35" />
      )}
    </TouchableOpacity>
  );

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Navigation Map</title>
<link href="https://unpkg.com/maplibre-gl@3.4.0/dist/maplibre-gl.css" rel="stylesheet" />
<script src="https://unpkg.com/maplibre-gl@3.4.0/dist/maplibre-gl.js"></script>
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
  #map { width: 100vw; height: 100vh; }
  .user-marker {
    width: 20px;
    height: 20px;
    background-color: #4A0D35;
    border-radius: 50%;
    border: 3px solid white;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
  }
</style>
</head>
<body>
<div id="map"></div>
<script>
  const API_KEY = "${GEOAPIFY_KEY}";
  let map = null;
  let userMarker = null;
  let routeLayers = {};
  
  function initMap() {
    map = new maplibre.Map({
      container: "map",
      style: "https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=" + API_KEY,
      center: [77.5946, 12.9716],
      zoom: 13,
      attributionControl: false
    });
    
    map.on('load', function() {
      window.ReactNativeWebView.postMessage(JSON.stringify({ 
        type: "mapReady",
        message: "Map is ready"
      }));
    });
    
    map.addControl(new maplibre.NavigationControl());
  }
  
  function drawRoute(routePoints, color = '#007BFF', width = 6, routeId = 'main') {
    if (!map || !routePoints || routePoints.length < 2) return;
    
    if (routeLayers[routeId]) {
      if (map.getLayer(routeId)) map.removeLayer(routeId);
      if (map.getSource(routeId)) map.removeSource(routeId);
    }
    
    const coordinates = routePoints.map(p => [p.lng, p.lat]);
    
    const routeFeature = {
      type: 'Feature',
      properties: { color: color },
      geometry: {
        type: 'LineString',
        coordinates: coordinates
      }
    };
    
    map.addSource(routeId, {
      type: 'geojson',
      data: routeFeature
    });
    
    map.addLayer({
      id: routeId,
      type: 'line',
      source: routeId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': color,
        'line-width': width,
        'line-opacity': routeId === 'main' ? 0.8 : 0.4
      }
    });
    
    routeLayers[routeId] = { source: routeId, color: color };
    
    fitMapToRoute(coordinates);
  }
  
  function fitMapToRoute(coordinates) {
    if (!map || coordinates.length < 2) return;
    
    const bounds = coordinates.reduce((bounds, coord) => {
      return bounds.extend(coord);
    }, new maplibre.LngLatBounds(coordinates[0], coordinates[0]));
    
    map.fitBounds(bounds, {
      padding: 50,
      duration: 1000,
      maxZoom: 16
    });
  }
  
  function updateUserPosition(position) {
    if (!map || !position) return;
    
    const coords = [position.lng, position.lat];
    
    if (!userMarker) {
      const el = document.createElement('div');
      el.className = 'user-marker';
      
      userMarker = new maplibre.Marker({
        element: el,
        anchor: 'center'
      })
      .setLngLat(coords)
      .addTo(map);
    } else {
      userMarker.setLngLat(coords);
    }
    
    map.easeTo({
      center: coords,
      zoom: 16,
      duration: 1000
    });
  }
  
  function clearAllRoutes() {
    Object.keys(routeLayers).forEach(routeId => {
      if (map.getLayer(routeId)) map.removeLayer(routeId);
      if (map.getSource(routeId)) map.removeSource(routeId);
    });
    routeLayers = {};
  }
  
  window.addEventListener("message", function(event) {
    try {
      const msg = JSON.parse(event.data);
      
      if (msg.type === "updateRoute") {
        if (msg.route && msg.route.length > 0) {
          drawRoute(
            msg.route, 
            msg.routeColor || '#007BFF', 
            6, 
            'main'
          );
        }
        
        if (msg.currentPosition) {
          updateUserPosition(msg.currentPosition);
        }
      }
      
      if (msg.type === "clearRoutes") {
        clearAllRoutes();
      }
      
    } catch (err) {
      console.error('Message parse error:', err);
    }
  });
  
  document.addEventListener("message", function(event) {
    window.dispatchEvent(new MessageEvent("message", {
      data: event.data
    }));
  });
  
  window.onload = initMap;
</script>
</body>
</html>`;

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor="#4A0D35" barStyle="light-content" />

      {/* Map */}
      <WebView
        ref={webRef}
        source={{ html: htmlContent }}
        style={styles.map}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.type === "mapReady") {
              setMapReady(true);
              if (navigationService) {
                setTimeout(() => updateMapRoute(), 100);
              }
            }
          } catch (e) { }
        }}
        renderLoading={() => (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#4A0D35" />
            <Text style={styles.loadingText}>Loading navigation map...</Text>
          </View>
        )}
      />

      {/* Top Navigation Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={stopNavigation} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>

        <View style={styles.topInfo}>
          <Text style={styles.destinationName} numberOfLines={1}>
            {locationName || "Destination"}
          </Text>
          <View style={styles.etaContainer}>
            <View style={styles.etaItem}>
              <Ionicons name="time-outline" size={14} color="rgba(255,255,255,0.8)" />
              <Text style={styles.etaText}>
                {allRoutes?.[selectedRouteIndex]?.duration || 0} min
              </Text>
            </View>
            <View style={styles.etaSeparator} />
            <View style={styles.etaItem}>
              <Ionicons name="walk-outline" size={14} color="rgba(255,255,255,0.8)" />
              <Text style={styles.etaText}>
                {allRoutes?.[selectedRouteIndex]?.distance || 0} km
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => setShowRouteOptions(true)}
          style={styles.routeButton}
        >
          <Ionicons name="swap-horizontal" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Route Options Modal */}
      <Modal
        visible={showRouteOptions}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowRouteOptions(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowRouteOptions(false)}
          />
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose Your Route</Text>
              <TouchableOpacity
                onPress={() => setShowRouteOptions(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              {allRoutes?.length || 0} route options available
            </Text>

            <ScrollView
              style={styles.routesList}
              showsVerticalScrollIndicator={false}
            >
              {allRoutes?.map((route, index) => (
                <RouteOptionItem
                  key={index}
                  route={route}
                  index={index}
                  isSelected={selectedRouteIndex === index}
                  onSelect={switchRoute}
                />
              ))}
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.recalculateButton}
                onPress={fetchNewRoutes}
                disabled={recalculating}
              >
                {recalculating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="refresh" size={20} color="#fff" />
                    <Text style={styles.recalculateButtonText}>Find New Routes</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.continueButton}
                onPress={() => setShowRouteOptions(false)}
              >
                <Text style={styles.continueButtonText}>Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Navigation Instructions */}
      {currentStep && (
        <View style={styles.instructionCard}>
          <View style={styles.instructionHeader}>
            <View style={styles.turnIconContainer}>
              <Ionicons
                name={getTurnIcon(currentStep.type)}
                size={28}
                color="#fff"
              />
            </View>
            <View style={styles.instructionContent}>
              <Text style={styles.instructionText}>
                {currentStep.text}
              </Text>

              {distanceToNext > 0 && currentStep.type !== 'destination' && (
                <Text style={styles.distanceText}>
                  {getDistanceText(distanceToNext)} to next turn
                </Text>
              )}
            </View>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressLabels}>
              <Text style={styles.progressLabel}>Progress</Text>
              <Text style={styles.progressPercentage}>{Math.round(progress)}%</Text>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
          </View>

          {/* Route Info */}
          <View style={styles.routeInfo}>
            <View style={styles.routeInfoItem}>
              <Ionicons name="walk-outline" size={16} color="#666" />
              <Text style={styles.routeInfoText}>
                {allRoutes?.[selectedRouteIndex]?.distance || 0} km
              </Text>
            </View>
            <View style={styles.routeInfoItem}>
              <Ionicons name="time-outline" size={16} color="#666" />
              <Text style={styles.routeInfoText}>
                {allRoutes?.[selectedRouteIndex]?.duration || 0} min
              </Text>
            </View>
            <View style={[
              styles.riskBadge,
              { backgroundColor: getRiskColor(allRoutes?.[selectedRouteIndex]?.total_risk || 0) }
            ]}>
              <Text style={styles.riskText}>
                {getRiskText(allRoutes?.[selectedRouteIndex]?.total_risk || 0)}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Bottom Controls */}
      <View style={styles.bottomControls}>
        <TouchableOpacity style={styles.controlButton}>
          <Ionicons name="volume-high-outline" size={24} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlButton} onPress={fetchNewRoutes}>
          <Ionicons name="refresh-outline" size={24} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.mainControlButton}
          onPress={togglePause}
        >
          <Ionicons
            name={isPaused ? "play" : "pause"}
            size={28}
            color="#fff"
          />
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlButton}>
          <Ionicons name="alert-circle-outline" size={24} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlButton}>
          <Ionicons name="menu-outline" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Next Step Preview */}
      {nextStep && (
        <View style={styles.nextStepCard}>
          <Text style={styles.nextStepLabel}>Next:</Text>
          <View style={styles.nextStepContent}>
            <View style={styles.nextStepIcon}>
              <Ionicons
                name={getTurnIcon(nextStep.type)}
                size={18}
                color="#666"
              />
            </View>
            <Text style={styles.nextStepText} numberOfLines={1}>
              {nextStep.text}
            </Text>
          </View>
        </View>
      )}

      {/* Recalculating Overlay */}
      {recalculating && (
        <View style={styles.recalculatingOverlay}>
          <View style={styles.recalculatingContainer}>
            <ActivityIndicator size="large" color="#4A0D35" />
            <Text style={styles.recalculatingText}>Finding new routes...</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  map: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  topBar: {
    position: "absolute",
    top: Platform.OS === 'ios' ? 44 : StatusBar.currentHeight,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#4A0D35',
    zIndex: 1000,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  topInfo: {
    flex: 1,
  },
  destinationName: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
  },
  etaContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  etaItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  etaText: {
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 14,
    marginLeft: 4,
  },
  etaSeparator: {
    width: 1,
    height: 14,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    marginHorizontal: 12,
  },
  routeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: height * 0.85,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#e0e0e0',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
  },
  modalCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubtitle: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 24,
  },
  routesList: {
    maxHeight: height * 0.45,
    paddingHorizontal: 24,
  },
  routeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#fff',
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  selectedRouteOption: {
    borderColor: '#007BFF',
    backgroundColor: '#f5f9ff',
  },
  routeIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  routeIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  routeDetails: {
    flex: 1,
  },
  routeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  routeTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  routeType: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
    flexShrink: 1,
  },
  selectedIndicator: {
    backgroundColor: '#007BFF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
  },
  selectedText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  riskBadgeSmall: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  riskTextSmall: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  routeStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 6,
    fontWeight: '500',
  },
  modalButtons: {
    paddingHorizontal: 24,
    marginTop: 20,
  },
  recalculateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    marginBottom: 12,
  },
  recalculateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  continueButton: {
    padding: 16,
    backgroundColor: '#4A0D35',
    borderRadius: 12,
    alignItems: 'center',
  },
  continueButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  instructionCard: {
    position: "absolute",
    top: Platform.OS === 'ios' ? 140 : 120,
    left: 20,
    right: 20,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
    zIndex: 900,
  },
  instructionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  turnIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#4A0D35",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  instructionContent: {
    flex: 1,
  },
  instructionText: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginBottom: 6,
  },
  distanceText: {
    fontSize: 15,
    color: "#666",
    fontWeight: '500',
  },
  progressContainer: {
    marginBottom: 20,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  progressPercentage: {
    fontSize: 14,
    color: '#4A0D35',
    fontWeight: '600',
  },
  progressBar: {
    height: 8,
    backgroundColor: "#e9ecef",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#00CC66",
    borderRadius: 4,
  },
  routeInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  routeInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  routeInfoText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
    marginLeft: 6,
  },
  riskBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  riskText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  bottomControls: {
    position: "absolute",
    bottom: 30,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: 30,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  controlButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  mainControlButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#4A0D35",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#4A0D35",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  nextStepCard: {
    position: "absolute",
    bottom: 110,
    left: 20,
    right: 20,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 6,
  },
  nextStepLabel: {
    fontSize: 12,
    color: "#999",
    marginBottom: 8,
    fontWeight: '500',
  },
  nextStepContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  nextStepIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  nextStepText: {
    fontSize: 16,
    color: "#333",
    fontWeight: '500',
    flex: 1,
  },
  recalculatingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2000,
  },
  recalculatingContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  recalculatingText: {
    color: '#333',
    fontSize: 16,
    marginTop: 16,
    fontWeight: '500',
  },
});