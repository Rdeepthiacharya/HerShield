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
  ActivityIndicator
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";

const { width, height } = Dimensions.get('window');
const API_URL = "http://192.168.1.100:5000"; // REPLACE WITH YOUR ACTUAL SERVER IP

// Debug function to check route data
const debugRouteData = (routeData) => {
  console.log("=== ROUTE DATA DEBUG ===");
  console.log("Total routes:", routeData?.length || 0);
  
  if (routeData && routeData.length > 0) {
    routeData.forEach((route, index) => {
      console.log(`Route ${index + 1}:`);
      console.log("- Type:", route.type);
      console.log("- Distance:", route.distance);
      console.log("- Duration:", route.duration);
      console.log("- Total Risk:", route.total_risk);
      console.log("- Color:", route.color);
      console.log("- Coords count:", route.coords?.length || 0);
      
      if (route.coords && route.coords.length > 0) {
        console.log("- First coord:", JSON.stringify(route.coords[0]));
        console.log("- Last coord:", JSON.stringify(route.coords[route.coords.length - 1]));
      }
    });
  } else {
    console.log("No route data available");
  }
  console.log("=== END DEBUG ===");
};

// Inline NavigationService class
class NavigationService {
  constructor(routes, onUpdate) {
    console.log("NavigationService initialized with routes:", routes?.length || 0);
    
    // Validate and format routes
    this.routes = this.validateAndFormatRoutes(routes || []);
    this.selectedRouteIndex = 0;
    this.currentRoute = this.routes?.[0] || null;
    this.onUpdate = onUpdate;
    this.isNavigating = false;
    this.currentPosition = null;
    this.currentStepIndex = 0;
    this.routeProgress = 0;
    this.locationSubscription = null;
    
    console.log("Current route set to:", this.currentRoute?.type);
    console.log("Current route has coords:", this.currentRoute?.coords?.length || 0);
  }

  validateAndFormatRoutes(routes) {
    if (!routes || routes.length === 0) {
      console.log("No routes provided");
      return [];
    }
    
    return routes.map((route, index) => {
      // Ensure route has required properties
      const formattedRoute = {
        ...route,
        type: route.type || `Route ${index + 1}`,
        color: route.color || (index === 0 ? '#4CAF50' : '#007BFF'),
        distance: route.distance || 0,
        duration: route.duration || 0,
        total_risk: route.total_risk || 0,
        coords: this.formatCoordinates(route.coords || [])
      };
      
      console.log(`Route ${index} formatted:`, {
        type: formattedRoute.type,
        coords: formattedRoute.coords.length,
        distance: formattedRoute.distance
      });
      
      return formattedRoute;
    });
  }

  formatCoordinates(coords) {
    if (!coords || !Array.isArray(coords)) {
      console.log("Invalid coordinates array");
      return [];
    }
    
    const formatted = coords.map((coord, index) => {
      // Handle both {latitude, longitude} and {lat, lng} formats
      const lat = coord.latitude || coord.lat;
      const lng = coord.longitude || coord.lng;
      
      if (lat === undefined || lng === undefined) {
        console.warn(`Invalid coordinate at index ${index}:`, coord);
        return null;
      }
      
      return {
        latitude: parseFloat(lat),
        longitude: parseFloat(lng),
        risk: coord.risk || false
      };
    }).filter(coord => coord !== null);
    
    console.log(`Formatted ${formatted.length} coordinates out of ${coords.length}`);
    return formatted;
  }

  async startNavigation() {
    if (this.isNavigating) {
      console.log("Navigation already in progress");
      return;
    }
    
    console.log("Starting navigation with route:", this.currentRoute?.type);
    console.log("Route coordinates:", this.currentRoute?.coords?.length || 0);
    
    try {
      // Dynamically import expo-location
      const { requestForegroundPermissionsAsync, getCurrentPositionAsync, watchPositionAsync } = await import('expo-location');
      
      // Request permissions
      console.log("Requesting location permissions...");
      const { status } = await requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        console.error("Location permission not granted");
        this.onUpdate?.({
          type: 'gps_error',
          error: 'Location permission not granted'
        });
        return;
      }
      
      console.log("Location permission granted, getting position...");
      
      // Get initial position
      const initialLocation = await getCurrentPositionAsync({
        accuracy: 6, // High accuracy
      });
      
      console.log("Initial position obtained:", {
        lat: initialLocation.coords.latitude,
        lng: initialLocation.coords.longitude
      });
      
      this.currentPosition = {
        latitude: initialLocation.coords.latitude,
        longitude: initialLocation.coords.longitude,
        accuracy: initialLocation.coords.accuracy,
        speed: initialLocation.coords.speed || 0,
        timestamp: new Date().toISOString()
      };
      
      this.isNavigating = true;
      
      // Start watching position
      this.watchPosition();
      
      // Send initial update with route data
      this.updateNavigation();
      
      console.log('Navigation started successfully');
      
    } catch (error) {
      console.error('Navigation start error:', error);
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
      
      console.log("Starting location watch...");
      
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
      
      console.log('Location watching started');
      
    } catch (error) {
      console.error('Watch position error:', error);
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
    
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
  }

  updateNavigation() {
    if (!this.currentPosition) {
      console.log("No current position available");
      return;
    }
    
    if (!this.currentRoute?.coords || this.currentRoute.coords.length === 0) {
      console.log("No route coordinates available");
      this.onUpdate?.({
        type: 'route_error',
        error: 'No route coordinates available'
      });
      return;
    }
    
    console.log("Updating navigation with position:", this.currentPosition);
    console.log("Route has", this.currentRoute.coords.length, "coordinates");
    
    const routeCoords = this.currentRoute.coords;
    
    // Find nearest point on route
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
    
    // Update current step index
    this.currentStepIndex = nearestIndex;
    
    // Check if user is off route (50 meters threshold)
    const isOffRoute = minDistance > 50;
    
    // Calculate progress percentage
    const progress = routeCoords.length > 1 ? 
      Math.min(100, Math.max(0, (nearestIndex / (routeCoords.length - 1)) * 100)) : 0;
    this.routeProgress = progress;
    
    // Get steps
    const steps = this.calculateSteps(routeCoords);
    let currentStep = null;
    let nextStep = null;
    
    // Find current and next steps
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (nearestIndex >= step.startIndex) {
        currentStep = step;
        nextStep = steps[i + 1];
      } else {
        break;
      }
    }
    
    // If no current step found, use first step
    if (!currentStep && steps.length > 0) {
      currentStep = steps[0];
      nextStep = steps[1];
    }
    
    // Calculate distance to next step
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
    
    console.log("Sending navigation update:", {
      type: updateData.type,
      progress: updateData.progress,
      stepText: currentStep?.text
    });
    
    this.onUpdate?.(updateData);
    
    // Check if reached destination
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
    if (!coords || coords.length < 2) {
      console.log("Not enough coordinates for steps");
      return [];
    }
    
    const steps = [];
    
    // Add start step
    steps.push({
      type: 'start',
      text: 'Start navigation',
      coordinate: coords[0],
      startIndex: 0,
      endIndex: 0
    });
    
    // Add destination step
    steps.push({
      type: 'destination',
      text: 'Arrive at destination',
      coordinate: coords[coords.length - 1],
      startIndex: coords.length - 1,
      endIndex: coords.length - 1
    });
    
    console.log("Calculated steps:", steps.length);
    return steps;
  }

  toRad(degrees) {
    return degrees * Math.PI / 180;
  }

  toDeg(radians) {
    return radians * 180 / Math.PI;
  }

  switchRoute(routeIndex) {
    console.log(`Attempting to switch to route ${routeIndex}`);
    
    if (routeIndex >= 0 && routeIndex < this.routes.length) {
      this.selectedRouteIndex = routeIndex;
      this.currentRoute = this.routes[routeIndex];
      this.currentStepIndex = 0;
      this.routeProgress = 0;
      
      console.log(`Switched to route ${routeIndex}:`, this.currentRoute.type);
      
      this.onUpdate?.({
        type: 'route_changed',
        route: this.currentRoute,
        selectedIndex: routeIndex
      });
      
      this.updateNavigation();
      
      return true;
    }
    
    console.log(`Invalid route index: ${routeIndex}`);
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
    console.log('Navigation stopped');
  }

  pauseNavigation() {
    if (this.locationSubscription) {
      this.locationSubscription.remove();
      this.locationSubscription = null;
    }
    this.isNavigating = false;
    console.log('Navigation paused');
  }

  resumeNavigation() {
    if (!this.isNavigating) {
      this.isNavigating = true;
      this.watchPosition();
      console.log('Navigation resumed');
    }
  }
}

export default function NavigationScreen({ navigation, route }) {
  const { routes: routeData, start, end, locationName } = route.params || {};
  const webRef = useRef(null);
  const [navigationService, setNavigationService] = useState(null);
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
  const [debugInfo, setDebugInfo] = useState("Initializing...");

  useEffect(() => {
    console.log("NavigationScreen mounted with params:", {
      hasRoutes: !!routeData,
      routeCount: routeData?.length || 0,
      start: start,
      end: end,
      locationName: locationName
    });
    
    // Debug the incoming route data
    debugRouteData(routeData);
    
    if (routeData && routeData.length > 0) {
      setAllRoutes(routeData);
      setDebugInfo(`Loaded ${routeData.length} routes`);
      console.log("Routes set to state:", routeData.length);
    } else {
      setDebugInfo("No routes provided");
      console.error("No route data received!");
      Alert.alert(
        "No Routes",
        "No route data was provided. Please go back and try again.",
        [{ text: "OK", onPress: () => navigation.goBack() }]
      );
    }
  }, [routeData]);

  useEffect(() => {
    console.log("allRoutes changed:", allRoutes.length);
    if (allRoutes.length > 0) {
      initializeNavigation();
    }
  }, [allRoutes]);

  useEffect(() => {
    return () => {
      if (navigationService) {
        console.log("Cleaning up navigation service");
        navigationService.stopNavigation();
      }
    };
  }, [navigationService]);

  useEffect(() => {
    // When map is ready, send the route data
    if (mapReady && navigationService) {
      console.log('Map ready, updating route...');
      setDebugInfo("Map ready, updating route...");
      updateMapRoute();
    }
  }, [mapReady, navigationService]);

  const initializeNavigation = () => {
    console.log('Initializing navigation with', allRoutes.length, 'routes');
    setDebugInfo(`Initializing with ${allRoutes.length} routes`);
    
    const navService = new NavigationService(
      allRoutes,
      (navUpdate) => {
        console.log("Navigation Update:", navUpdate.type);
        setDebugInfo(`Update: ${navUpdate.type}`);
        
        if (navUpdate.type === 'step_updated' || navUpdate.type === 'route_changed') {
          setCurrentStep(navUpdate.currentStep);
          setNextStep(navUpdate.nextStep);
          setProgress(navUpdate.progress);
          setDistanceToNext(navUpdate.distanceToNext || 0);
          if (navUpdate.currentPosition) {
            setCurrentPosition(navUpdate.currentPosition);
          }
          
          // Update WebView with full route data
          if (webRef.current && mapReady) {
            console.log('Updating map route from navigation update...');
            updateMapRoute();
          }
        }
        
        if (navUpdate.type === 'off_route') {
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
          Alert.alert(
            "Arrived at Destination",
            "You have safely reached your destination!",
            [{ text: "OK", onPress: () => navigation.goBack() }]
          );
        }
        
        if (navUpdate.type === 'gps_error') {
          Alert.alert(
            "GPS Error",
            navUpdate.error || "Unable to get your location",
            [{ text: "OK" }]
          );
        }
        
        if (navUpdate.type === 'route_error') {
          console.error("Route error:", navUpdate.error);
          setDebugInfo(`Route Error: ${navUpdate.error}`);
        }
      }
    );

    setNavigationService(navService);
    navService.startNavigation();
  };

  const updateMapRoute = () => {
    if (!navigationService || !navigationService.getCurrentRoute()) {
      console.log('No navigation service or current route');
      setDebugInfo("No route to display");
      return;
    }
    
    const route = navigationService.getCurrentRoute();
    console.log('Updating map with route:', {
      type: route.type,
      coordsCount: route.coords?.length || 0,
      distance: route.distance,
      color: route.color
    });
    
    setDebugInfo(`Drawing: ${route.type} with ${route.coords?.length || 0} points`);
    
    if (!route.coords || route.coords.length === 0) {
      console.log('Route has no coordinates');
      setDebugInfo("Route has no coordinates");
      return;
    }
    
    const allAvailableRoutes = navigationService.getAllRoutes();
    
    // Convert current route coordinates
    const routePoints = route.coords.map(coord => ({
      lat: coord.latitude,
      lng: coord.longitude
    }));
    
    console.log('Route points to draw:', routePoints.length);
    
    // Convert all routes for alternatives display
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
    
    console.log('Sending message to WebView:', {
      type: message.type,
      routePoints: message.route.length,
      hasPosition: !!message.currentPosition
    });
    
    if (webRef.current) {
      webRef.current.postMessage(JSON.stringify(message));
      setDebugInfo(`Sent route to map (${routePoints.length} points)`);
    } else {
      console.error('WebView ref not available');
      setDebugInfo("WebView not ready");
    }
  };

  const switchRoute = (index) => {
    console.log('Switching to route index:', index);
    if (navigationService) {
      const success = navigationService.switchRoute(index);
      if (success) {
        setSelectedRouteIndex(index);
        setShowRouteOptions(false);
        setDebugInfo(`Switched to route ${index + 1}`);
        
        // Update map immediately
        if (webRef.current && mapReady) {
          updateMapRoute();
        }
      }
    }
  };

  const recalculateRoute = async () => {
    setRecalculating(true);
    setDebugInfo("Recalculating route...");
    await fetchNewRoutes();
  };

  const fetchNewRoutes = async () => {
    try {
      setRecalculating(true);
      setDebugInfo("Fetching new routes...");
      
      if (!start || !end) {
        Alert.alert("Error", "Start and end points are required");
        setDebugInfo("Missing start/end points");
        return;
      }
      
      console.log('Fetching new routes from:', API_URL, 'with:', { start, end });
      
      // Get fresh routes from backend
      const response = await fetch(`${API_URL}/safe_route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: start,
          end: end
        })
      });
      
      const data = await response.json();
      console.log('New routes response:', data);
      
      if (data.success && data.routes && data.routes.length > 0) {
        // Update routes
        const newRoutes = data.routes;
        setAllRoutes(newRoutes);
        
        // Stop current navigation
        if (navigationService) {
          navigationService.stopNavigation();
        }
        
        // Reset states
        setSelectedRouteIndex(0);
        setProgress(0);
        setCurrentStep(null);
        setNextStep(null);
        setDistanceToNext(0);
        
        // Clear map routes
        if (webRef.current && mapReady) {
          webRef.current.postMessage(JSON.stringify({ type: "clearRoutes" }));
        }
        
        // Show route options modal
        setShowRouteOptions(true);
        
        Alert.alert(
          "New Routes Found",
          `${newRoutes.length} route options available`
        );
        
        setDebugInfo(`Found ${newRoutes.length} new routes`);
      } else {
        Alert.alert("Error", "Could not find alternative routes");
        setDebugInfo("No routes found from server");
      }
    } catch (error) {
      console.error("Recalculation error:", error);
      Alert.alert("Error", "Failed to recalculate routes");
      setDebugInfo(`Error: ${error.message}`);
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
    setDebugInfo(isPaused ? "Resumed" : "Paused");
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
    switch(type) {
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
    >
      <View style={styles.routeIcon}>
        <View style={[
          styles.routeIndicator,
          { backgroundColor: route.color || '#4CAF50' }
        ]} />
      </View>
      
      <View style={styles.routeDetails}>
        <View style={styles.routeHeader}>
          <Text style={styles.routeType}>{route.type || `Route ${index + 1}`}</Text>
          <View style={[
            styles.riskBadgeSmall,
            { backgroundColor: getRiskColor(route.total_risk || 0) + '20' }
          ]}>
            <Text style={[
              styles.riskTextSmall,
              { color: getRiskColor(route.total_risk || 0) }
            ]}>
              {getRiskText(route.total_risk || 0)}
            </Text>
          </View>
        </View>
        
        <View style={styles.routeStatsRow}>
          <View style={styles.statItem}>
            <Ionicons name="walk" size={14} color="#666" />
            <Text style={styles.statText}>{route.distance || 0} km</Text>
          </View>
          <View style={styles.statItem}>
            <Ionicons name="time" size={14} color="#666" />
            <Text style={styles.statText}>{route.duration || 0} min</Text>
          </View>
          <View style={styles.statItem}>
            <Ionicons name="warning" size={14} color="#666" />
            <Text style={styles.statText}>{route.total_risk || 0} risks</Text>
          </View>
        </View>
        
        {route.description && (
          <Text style={styles.routeDescription}>{route.description}</Text>
        )}
      </View>
      
      {isSelected && (
        <Ionicons name="checkmark-circle" size={24} color="#007BFF" />
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
    background-color: #007BFF;
    border-radius: 50%;
    border: 3px solid white;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
  }
  .route-label {
    background: white;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: bold;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .debug-console {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgba(0,0,0,0.7);
    color: white;
    padding: 10px;
    border-radius: 5px;
    font-size: 12px;
    max-width: 300px;
    z-index: 1000;
  }
</style>
</head>
<body>
<div id="map"></div>
<div id="debug" class="debug-console">Waiting for data...</div>
<script>
  const API_KEY = "01e115490b5549cc9eff64708491d30e";
  let map = null;
  let userMarker = null;
  let routeLayers = {};
  
  function updateDebug(message) {
    const debugEl = document.getElementById('debug');
    if (debugEl) {
      debugEl.innerHTML = message + '<br>' + new Date().toLocaleTimeString();
    }
    console.log('Map Debug:', message);
  }
  
  // Initialize map
  function initMap() {
    updateDebug('Initializing map...');
    
    // Default center (Bangalore)
    let center = [77.5946, 12.9716];
    let zoom = 13;
    
    try {
      map = new maplibre.Map({
        container: "map",
        style: "https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=" + API_KEY,
        center: center,
        zoom: zoom,
        attributionControl: false
      });
      
      map.on('load', function() {
        updateDebug('Map loaded successfully');
        window.ReactNativeWebView.postMessage(JSON.stringify({ 
          type: "mapReady",
          message: "Map is ready"
        }));
      });
      
      map.on('error', function(e) {
        updateDebug('Map error: ' + e.error);
        console.error('Map error:', e);
      });
      
      // Add zoom controls
      map.addControl(new maplibre.NavigationControl());
      
      updateDebug('Map initialized');
      
    } catch (error) {
      updateDebug('Failed to initialize map: ' + error.message);
      console.error('Map init error:', error);
    }
  }
  
  // Draw route with custom color
  function drawRoute(routePoints, color = '#007BFF', width = 6, routeId = 'main', label = '') {
    if (!map) {
      updateDebug('Map not ready for drawing');
      return;
    }
    
    if (!routePoints || routePoints.length < 2) {
      updateDebug('Not enough points to draw route: ' + (routePoints?.length || 0));
      return;
    }
    
    updateDebug('Drawing route ' + routeId + ' with ' + routePoints.length + ' points');
    
    // Remove existing layer if it exists
    if (routeLayers[routeId]) {
      if (map.getLayer(routeId)) {
        map.removeLayer(routeId);
      }
      if (map.getSource(routeId)) {
        map.removeSource(routeId);
      }
    }
    
    const coordinates = routePoints.map(p => {
      if (!p || p.lat === undefined || p.lng === undefined) {
        console.warn('Invalid point:', p);
        return null;
      }
      return [p.lng, p.lat];
    }).filter(coord => coord !== null);
    
    if (coordinates.length < 2) {
      updateDebug('No valid coordinates after filtering');
      return;
    }
    
    try {
      // Create GeoJSON feature
      const routeFeature = {
        type: 'Feature',
        properties: {
          name: label,
          color: color
        },
        geometry: {
          type: 'LineString',
          coordinates: coordinates
        }
      };
      
      // Add route source
      map.addSource(routeId, {
        type: 'geojson',
        data: routeFeature
      });
      
      // Add route layer
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
      
      // Store reference
      routeLayers[routeId] = { source: routeId, color: color };
      
      updateDebug('Route ' + routeId + ' drawn successfully');
      
      // Fit map to show entire route
      fitMapToRoute(coordinates);
      
    } catch (error) {
      updateDebug('Error drawing route: ' + error.message);
      console.error('Draw route error:', error);
    }
  }
  
  // Fit map to show route
  function fitMapToRoute(coordinates) {
    if (!map || coordinates.length < 2) return;
    
    try {
      const bounds = coordinates.reduce((bounds, coord) => {
        return bounds.extend(coord);
      }, new maplibre.LngLatBounds(coordinates[0], coordinates[0]));
      
      map.fitBounds(bounds, {
        padding: 50,
        duration: 1000,
        maxZoom: 16
      });
      
      updateDebug('Map fitted to route');
    } catch (error) {
      console.error('Error fitting map:', error);
    }
  }
  
  // Update user position
  function updateUserPosition(position) {
    if (!map || !position) {
      updateDebug('Cannot update position: map=' + !!map + ', pos=' + !!position);
      return;
    }
    
    updateDebug('Updating user position: ' + position.lat + ', ' + position.lng);
    
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
    
    // Center map on user
    map.easeTo({
      center: coords,
      zoom: 16,
      duration: 1000
    });
  }
  
  // Clear all routes
  function clearAllRoutes() {
    Object.keys(routeLayers).forEach(routeId => {
      if (map.getLayer(routeId)) map.removeLayer(routeId);
      if (map.getSource(routeId)) map.removeSource(routeId);
    });
    routeLayers = {};
    updateDebug('All routes cleared');
  }
  
  // Handle messages from React Native
  window.addEventListener("message", function(event) {
    try {
      const msg = JSON.parse(event.data);
      updateDebug('Received: ' + msg.type);
      
      if (msg.type === "updateRoute") {
        updateDebug('Drawing route with ' + (msg.route?.length || 0) + ' points');
        
        // Draw main route
        if (msg.route && msg.route.length > 0) {
          drawRoute(
            msg.route, 
            msg.routeColor || '#007BFF', 
            6, 
            'main',
            'Your Route'
          );
        }
        
        // Update user position
        if (msg.currentPosition) {
          updateUserPosition(msg.currentPosition);
        }
      }
      
      if (msg.type === "clearRoutes") {
        clearAllRoutes();
      }
      
    } catch (err) {
      updateDebug('Message error: ' + err.message);
      console.error('Message parse error:', err, 'Data:', event.data);
    }
  });
  
  // Also handle the React Native WebView message format
  document.addEventListener("message", function(event) {
    window.dispatchEvent(new MessageEvent("message", {
      data: event.data
    }));
  });
  
  // Initialize map when page loads
  window.onload = initMap;
</script>
</body>
</html>`;

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor="#000" barStyle="light-content" />
      
      {/* Map */}
      <WebView
        ref={webRef}
        source={{ html: htmlContent }}
        style={styles.map}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        onLoadStart={() => {
          console.log('WebView loading started');
          setDebugInfo("Loading map...");
        }}
        onLoadEnd={() => {
          console.log('WebView loading finished');
          setDebugInfo("Map loaded, waiting for data...");
        }}
        onError={(error) => {
          console.error('WebView error:', error);
          setDebugInfo(`WebView error: ${error.nativeEvent.description}`);
        }}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            console.log('Message from WebView:', data);
            if (data.type === "mapReady") {
              console.log('Map is ready!');
              setMapReady(true);
              setDebugInfo("Map ready");
              // Send route data immediately when map is ready
              if (navigationService) {
                setTimeout(() => {
                  updateMapRoute();
                }, 100);
              }
            }
          } catch (e) {
            console.error('Error parsing WebView message:', e);
          }
        }}
        renderLoading={() => (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007BFF" />
            <Text style={styles.loadingText}>Loading navigation map...</Text>
          </View>
        )}
      />

      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={stopNavigation} style={styles.topButton}>
          <Ionicons name="close" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.topInfo}>
          <Text style={styles.destinationName} numberOfLines={1}>
            {locationName || "Destination"}
          </Text>
          <Text style={styles.eta}>
            {allRoutes?.[selectedRouteIndex]?.duration || 0} min • 
            {allRoutes?.[selectedRouteIndex]?.distance || 0} km • 
            <Text style={{ color: getRiskColor(allRoutes?.[selectedRouteIndex]?.total_risk || 0) }}>
              {" " + getRiskText(allRoutes?.[selectedRouteIndex]?.total_risk || 0)}
            </Text>
          </Text>
        </View>
        <TouchableOpacity 
          onPress={() => setShowRouteOptions(true)} 
          style={styles.topButton}
        >
          <Ionicons name="swap-horizontal" size={24} color="#fff" />
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
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose Your Route</Text>
              <TouchableOpacity onPress={() => setShowRouteOptions(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalSubtitle}>
              {allRoutes?.length || 0} route options available
            </Text>
            
            <ScrollView style={styles.routesList}>
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
            
            <TouchableOpacity 
              style={styles.recalculateButton}
              onPress={fetchNewRoutes}
              disabled={recalculating}
            >
              {recalculating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="refresh" size={20} color="#fff" />
                  <Text style={styles.recalculateButtonText}>Find New Routes</Text>
                </>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.closeButton}
              onPress={() => setShowRouteOptions(false)}
            >
              <Text style={styles.closeButtonText}>Continue Navigation</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Navigation Instructions */}
      {currentStep && (
        <View style={styles.instructionCard}>
          <View style={styles.instructionHeader}>
            <Ionicons 
              name={getTurnIcon(currentStep.type)} 
              size={32} 
              color="#007BFF" 
            />
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
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
            <Text style={styles.progressText}>{Math.round(progress)}% Complete</Text>
          </View>
          
          {/* Route Info */}
          <View style={styles.routeInfo}>
            <Text style={styles.routeInfoText}>
              {allRoutes?.[selectedRouteIndex]?.distance || 0} km • 
              {allRoutes?.[selectedRouteIndex]?.duration || 0} min remaining
            </Text>
            <View style={[
              styles.riskBadge,
              { backgroundColor: getRiskColor(allRoutes?.[selectedRouteIndex]?.total_risk || 0) + '20' }
            ]}>
              <Text style={[
                styles.riskText,
                { color: getRiskColor(allRoutes?.[selectedRouteIndex]?.total_risk || 0) }
              ]}>
                {getRiskText(allRoutes?.[selectedRouteIndex]?.total_risk || 0)}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Next Step Preview */}
      {nextStep && (
        <View style={styles.nextStepCard}>
          <Text style={styles.nextStepLabel}>Next:</Text>
          <View style={styles.nextStepContent}>
            <Ionicons 
              name={getTurnIcon(nextStep.type)} 
              size={20} 
              color="#666" 
            />
            <Text style={styles.nextStepText}>{nextStep.text}</Text>
          </View>
        </View>
      )}

      {/* Bottom Controls */}
      <View style={styles.bottomControls}>
        <TouchableOpacity style={styles.controlButton}>
          <Ionicons name="volume-high" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={fetchNewRoutes}>
          <Ionicons name="refresh" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={togglePause}>
          <Ionicons name={isPaused ? "play" : "pause"} size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton}>
          <Ionicons name="warning" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Debug Info */}
      <View style={styles.debugInfo}>
        <Text style={styles.debugText}>
          {debugInfo}
        </Text>
      </View>

      {/* Recalculating Overlay */}
      {recalculating && (
        <View style={styles.recalculatingOverlay}>
          <ActivityIndicator size="large" color="#007BFF" />
          <Text style={styles.recalculatingText}>Finding new routes...</Text>
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
    marginTop: 10,
    fontSize: 16,
    color: '#333',
  },
  topBar: {
    position: "absolute",
    top: Platform.OS === 'ios' ? 50 : 40,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    zIndex: 1000,
  },
  topButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  topInfo: {
    flex: 1,
    alignItems: "center",
    marginHorizontal: 10,
  },
  destinationName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  eta: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 12,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: height * 0.7,
    paddingBottom: Platform.OS === 'ios' ? 30 : 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 10,
  },
  routesList: {
    maxHeight: height * 0.4,
    paddingHorizontal: 20,
  },
  routeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  selectedRouteOption: {
    backgroundColor: '#f5f9ff',
    borderLeftWidth: 3,
    borderLeftColor: '#007BFF',
  },
  routeIcon: {
    marginRight: 15,
  },
  routeIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  routeDetails: {
    flex: 1,
  },
  routeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  routeType: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  riskBadgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
  },
  riskTextSmall: {
    fontSize: 10,
    fontWeight: '600',
  },
  routeStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 4,
  },
  routeDescription: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
  },
  recalculateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    backgroundColor: '#4CAF50',
    marginHorizontal: 20,
    marginTop: 15,
    borderRadius: 10,
  },
  recalculateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 10,
  },
  closeButton: {
    padding: 15,
    backgroundColor: '#007BFF',
    marginHorizontal: 20,
    marginTop: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  instructionCard: {
    position: "absolute",
    top: height * 0.15,
    left: 20,
    right: 20,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 20,
    padding: 20,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  instructionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
  },
  instructionContent: {
    flex: 1,
    marginLeft: 15,
  },
  instructionText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 5,
  },
  distanceText: {
    fontSize: 14,
    color: "#666",
  },
  progressContainer: {
    marginBottom: 15,
  },
  progressBar: {
    height: 6,
    backgroundColor: "#e9ecef",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#00CC66",
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
  },
  routeInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  routeInfoText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  riskBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  riskText: {
    fontSize: 12,
    fontWeight: '600',
  },
  nextStepCard: {
    position: "absolute",
    top: height * 0.4,
    left: 20,
    right: 20,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    borderRadius: 15,
    padding: 15,
  },
  nextStepLabel: {
    fontSize: 12,
    color: "#999",
    marginBottom: 5,
  },
  nextStepContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  nextStepText: {
    fontSize: 16,
    color: "#333",
    marginLeft: 10,
  },
  bottomControls: {
    position: "absolute",
    bottom: 30,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  controlButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    alignItems: "center",
    justifyContent: "center",
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
  recalculatingText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 15,
  },
  debugInfo: {
    position: 'absolute',
    top: 100,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 8,
    borderRadius: 5,
    zIndex: 1000,
  },
  debugText: {
    color: '#fff',
    fontSize: 12,
    textAlign: 'center',
  },
});