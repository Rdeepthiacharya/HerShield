import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Platform,
  Alert,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { WebView } from "react-native-webview";
import * as Location from 'expo-location';
import { Ionicons } from "@expo/vector-icons";
import AppHeader from "../components/AppHeader";

const { width, height } = Dimensions.get('window');

// Geoapify API Key
const GEOAPIFY_API_KEY = "01e115490b5549cc9eff64708491d30e";

// Karnataka bounding box for strict filtering
const KARNATAKA_BOUNDS = {
  minLat: 11.5,
  maxLat: 18.45,
  minLng: 74.0,
  maxLng: 78.6
};

export default function LocationPickerModal({ onClose, onLocationSelected }) {
  const webViewRef = useRef(null);
  const searchDebounceRef = useRef(null);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedCoord, setSelectedCoord] = useState(null);
  const [selectedPlaceName, setSelectedPlaceName] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  
  const [isLoading, setIsLoading] = useState(false);
  const [locationMethod, setLocationMethod] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [isLoadingMap, setIsLoadingMap] = useState(true);
  const [isLocationInKarnataka, setIsLocationInKarnataka] = useState(true);
  const [showSearchBar, setShowSearchBar] = useState(false);

  // Strict check if coordinates are within Karnataka
  const checkIfInKarnataka = (lat, lng) => {
    return (
      lat >= KARNATAKA_BOUNDS.minLat &&
      lat <= KARNATAKA_BOUNDS.maxLat &&
      lng >= KARNATAKA_BOUNDS.minLng &&
      lng <= KARNATAKA_BOUNDS.maxLng
    );
  };

  // HTML content for WebView map with Karnataka restrictions
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Select Location</title>
<link href="https://unpkg.com/maplibre-gl@3.4.0/dist/maplibre-gl.css" rel="stylesheet" />
<script src="https://unpkg.com/maplibre-gl@3.4.0/dist/maplibre-gl.js"></script>

<style>
  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  #map { 
    width: 100vw; 
    height: 100vh; 
  }
  .maplibregl-control-container { 
    display: none !important; 
  }
  
  .selection-marker {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background-color: rgba(139, 19, 62, 0.2);
    border: 3px solid #8B133E;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .selection-marker svg {
    width: 24px;
    height: 24px;
    fill: #8B133E;
  }
  
  .current-location-marker {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background-color: rgba(0, 123, 255, 0.2);
    border: 3px solid #007BFF;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .current-location-marker svg {
    width: 18px;
    height: 18px;
    fill: #007BFF;
  }
  
  .outside-karnataka-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(255, 0, 0, 0.05);
    z-index: 999;
    pointer-events: none;
    display: none;
  }
</style>
</head>

<body>
<div id="map"></div>
</div>
<div id="outsideKarnatakaOverlay" class="outside-karnataka-overlay"></div>

<script>
  const API_KEY = "${GEOAPIFY_API_KEY}";
  let map = null;
  let selectionMarker = null;
  let selectionPopup = null;
  let currentLocationMarker = null;
  
  // Karnataka bounding coordinates - STRICT BOUNDS
  const KARNATAKA_BOUNDS = [
    [74.0, 11.5], // Southwest [lon, lat]
    [78.6, 18.45]  // Northeast [lon, lat]
  ];

  // Initialize map
  function initMap() {
    map = new maplibregl.Map({
      container: "map",
      style: "https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=" + API_KEY,
      center: [76.5, 15.0],
      zoom: 7,
      attributionControl: false,
      maxBounds: KARNATAKA_BOUNDS,
      maxZoom: 18,
      minZoom: 7
    });

    // Add Karnataka boundary layer when map loads
    map.on("load", function() {
      // Add Karnataka boundary source
      map.addSource('karnataka-boundary', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [74.0, 11.5],
              [78.6, 11.5],
              [78.6, 18.45],
              [74.0, 18.45],
              [74.0, 11.5]
            ]]
          },
          properties: {}
        }
      });

      // Add fill layer for Karnataka
      map.addLayer({
        id: 'karnataka-fill',
        type: 'fill',
        source: 'karnataka-boundary',
        paint: {
          'fill-color': 'rgba(76, 175, 80, 0.05)',
          'fill-outline-color': 'rgba(76, 175, 80, 0)'
        }
      });

      // Add border layer
      map.addLayer({
        id: 'karnataka-border',
        type: 'line',
        source: 'karnataka-boundary',
        paint: {
          'line-color': '#4CAF50',
          'line-width': 2,
          'line-dasharray': [2, 1]
        }
      });

      // Notify React Native
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: "mapLoaded" })
        );
      }
      
      // Set initial bounds
      map.fitBounds(KARNATAKA_BOUNDS, {
        padding: 50,
        duration: 1000
      });
    });

    // Handle map clicks
    map.on("click", function(e) {
      const coord = { 
        lat: e.lngLat.lat, 
        lng: e.lngLat.lng 
      };
      
      // Check if clicked location is within Karnataka
      const isInKarnataka = checkIfInKarnataka(coord.lng, coord.lat);
      
      if (!isInKarnataka) {
        // Show red overlay
        document.getElementById('outsideKarnatakaOverlay').style.display = 'block';
        setTimeout(() => {
          document.getElementById('outsideKarnatakaOverlay').style.display = 'none';
        }, 1000);
        
        // Send warning to React Native
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(
            JSON.stringify({ 
              type: "outsideKarnatakaClick",
              coord: coord
            })
          );
        }
        return;
      }
      
      // Update marker
      updateSelectionMarker(coord, true);
      
      // Send to React Native
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ 
            type: "locationSelectedFromMap", 
            coord: coord,
            isInKarnataka: true
          })
        );
      }
    });

    // Prevent dragging outside Karnataka
    map.on("move", function() {
      const bounds = map.getBounds();
      const center = bounds.getCenter();
      
      if (!checkIfInKarnataka(center.lng, center.lat)) {
        document.getElementById('outsideKarnatakaOverlay').style.display = 'block';
      } else {
        document.getElementById('outsideKarnatakaOverlay').style.display = 'none';
      }
    });
  }

  // Check if coordinates are within Karnataka
  function checkIfInKarnataka(lng, lat) {
    return (
      lng >= KARNATAKA_BOUNDS[0][0] &&
      lng <= KARNATAKA_BOUNDS[1][0] &&
      lat >= KARNATAKA_BOUNDS[0][1] &&
      lat <= KARNATAKA_BOUNDS[1][1]
    );
  }

  // Update current location marker
  function updateCurrentLocationMarker(coord) {
    if (currentLocationMarker) {
      currentLocationMarker.remove();
    }
    
    const el = document.createElement('div');
    el.className = 'current-location-marker';
    el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>';
    
    currentLocationMarker = new maplibregl.Marker({
      element: el,
      draggable: false
    })
      .setLngLat([coord.lng, coord.lat])
      .addTo(map);
  }

  // Update selection marker
  function updateSelectionMarker(coord) {
    if (selectionMarker) {
      selectionMarker.remove();
    }
    if (selectionPopup) {
      selectionPopup.remove();
    }
    
    const el = document.createElement('div');
    el.className = 'selection-marker';
    el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>';
    
    selectionMarker = new maplibregl.Marker({
      element: el,
      draggable: false
    })
      .setLngLat([coord.lng, coord.lat])
      .addTo(map);
    
    // Center map on selection
    map.flyTo({
      center: [coord.lng, coord.lat],
      zoom: 15,
      duration: 1000
    });
  }

  // Receive messages from React Native
  document.addEventListener("message", function(event) {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === "centerMap") {
        const coord = msg.coord;
        
        // Check if location is in Karnataka
        const isInKarnataka = checkIfInKarnataka(coord.lng, coord.lat);
        
        if (map && isInKarnataka) {
          map.flyTo({
            center: [coord.lng, coord.lat],
            zoom: 15,
            duration: 1000
          });
          
          updateSelectionMarker(coord);
        }
      }
      
      if (msg.type === "showCurrentLocation") {
        const coord = msg.coord;
        if (map) {
          updateCurrentLocationMarker(coord);
          
          // Center map only if in Karnataka
          if (checkIfInKarnataka(coord.lng, coord.lat)) {
            map.flyTo({
              center: [coord.lng, coord.lat],
              zoom: 15,
              duration: 1000
            });
          }
        }
      }
      
      if (msg.type === "setKarnatakaView") {
        if (map) {
          map.fitBounds(KARNATAKA_BOUNDS, {
            padding: 50,
            duration: 1000
          });
        }
      }
    } catch (err) {
      console.log("Message parse error:", err);
    }
  });

  // Initialize
  initMap();
</script>
</body>
</html>`;

  // Get current location
  useEffect(() => {
    getCurrentLocation();
  }, []);

  // Get current location
  const getCurrentLocation = async () => {
    try {
      setIsLoading(true);
      
      let { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        Alert.alert(
          'Location Permission Required',
          'Please enable location permissions to use current location.',
          [{ text: 'OK', style: 'cancel' }]
        );
        setIsLoading(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const lat = location.coords.latitude;
      const lon = location.coords.longitude;
      
      const coordObj = { latitude: lat, longitude: lon };
      const isInKarnataka = checkIfInKarnataka(lat, lon);
      
      setUserLocation(coordObj);
      setLocationMethod('live');
      
      if (isInKarnataka) {
        setSelectedCoord(coordObj);
        setIsLocationInKarnataka(true);
        
        // Get address
        const address = await getAddressFromCoords(lat, lon);
        setSelectedPlaceName(address);
        
        // Center map on location
        if (webViewRef.current) {
          webViewRef.current.postMessage(
            JSON.stringify({ 
              type: "showCurrentLocation", 
              coord: { lat, lng: lon }
            })
          );
        }
      } else {
        setIsLocationInKarnataka(false);
        
        // Still center on current location
        if (webViewRef.current) {
          webViewRef.current.postMessage(
            JSON.stringify({ 
              type: "centerMap", 
              coord: { lat, lng: lon }
            })
          );
        }
      }
      
    } catch (error) {
      console.log("Error getting location:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Get address from coordinates using Geoapify
  const getAddressFromCoords = async (lat, lon) => {
    try {
      const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${GEOAPIFY_API_KEY}`;
      
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.features && data.features.length > 0) {
        const props = data.features[0].properties;
        return props.formatted || '';
      }
    } catch (error) {
      console.log("Reverse geocoding error:", error);
    }
    return '';
  };

  // ENHANCED SEARCH: Geoapify Autocomplete with STRICT Karnataka restriction
  const searchLocation = async (text) => {
    if (text.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchQuery(text);
    
    // Clear previous debounce timer
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    
    // Set new debounce timer
    searchDebounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      
      try {
        // GEOAPIFY AUTOCOMPLETE WITH KARNATAKA RESTRICTION
        const url = `https://api.geoapify.com/v1/geocode/autocomplete?` +
          `text=${encodeURIComponent(text)}&` +
          `filter=rect:${KARNATAKA_BOUNDS.minLng},${KARNATAKA_BOUNDS.minLat},${KARNATAKA_BOUNDS.maxLng},${KARNATAKA_BOUNDS.maxLat}&` +
          `bias=countrycode:in&` +
          `limit=8&` +
          `apiKey=${GEOAPIFY_API_KEY}`;
        
        console.log("Searching with Karnataka restriction:", url);
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
          // Process and enhance results
          const processedResults = data.features.map(feature => {
            const props = feature.properties;
            
            // Create display text
            const displayParts = [];
            if (props.name) displayParts.push(props.name);
            if (props.street && props.street !== props.name) displayParts.push(props.street);
            if (props.city) displayParts.push(props.city);
            if (props.district) displayParts.push(props.district);
            if (props.state) displayParts.push(props.state);
            
            const displayText = displayParts.join(', ');
            
            // Determine icon type
            let iconType = 'location-outline';
            if (props.category === 'commercial') iconType = 'business';
            if (props.category === 'building') iconType = 'business';
            if (props.category === 'highway') iconType = 'road';
            if (props.category === 'natural') iconType = 'leaf';
            if (props.category === 'tourism') iconType = 'camera';
            
            // Calculate relevance score
            let score = 0;
            const searchLower = text.toLowerCase();
            
            if (props.name && props.name.toLowerCase().includes(searchLower)) score += 10;
            if (props.street && props.street.toLowerCase().includes(searchLower)) score += 8;
            if (props.city && props.city.toLowerCase().includes(searchLower)) score += 6;
            if (props.state === 'Karnataka') score += 5;
            if (props.type === 'amenity') score += 3;
            
            return {
              ...feature,
              properties: {
                ...props,
                display_text: displayText,
                icon_type: iconType,
                relevance_score: score,
                is_karnataka: props.state === 'Karnataka' || props.state_code === 'KA'
              }
            };
          });
          
          // Sort by relevance
          processedResults.sort((a, b) => b.properties.relevance_score - a.properties.relevance_score);
          
          setSearchResults(processedResults);
          
        } else {
          setSearchResults([]);
        }
        
      } catch (error) {
        console.log("Search error:", error);
        setSearchResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 300); // 300ms debounce
  };

  // Select search result
  const handleSelectSearchResult = async (feature) => {
    const props = feature.properties;
    const lat = parseFloat(props.lat);
    const lon = parseFloat(props.lon);
    
    // Verify it's in Karnataka (double check)
    const isInKarnataka = checkIfInKarnataka(lat, lon);
    
    if (!isInKarnataka) {
      setIsLocationInKarnataka(false);
      return;
    }

    const coordObj = { latitude: lat, longitude: lon };
    setSelectedCoord(coordObj);
    setSelectedPlaceName(props.display_text);
    setIsLocationInKarnataka(true);
    setLocationMethod('search');

    setSearchResults([]);
    setSearchQuery(props.name || props.street || props.city || "");

      setShowSearchBar(false);
  setIsSearchFocused(false);

    // Get detailed address
    const detailedAddress = await getAddressFromCoords(lat, lon);
    if (detailedAddress) {
      setSelectedPlaceName(detailedAddress);
    }

    // Center map on selected location
    if (webViewRef.current) {
      webViewRef.current.postMessage(
        JSON.stringify({ 
          type: "centerMap", 
          coord: { lat, lng: lon }
        })
      );
    }
  };

  // Handle messages from WebView
  const handleWebViewMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      
      if (msg.type === "locationSelectedFromMap") {
        const coord = msg.coord;
        const coordObj = { latitude: coord.lat, longitude: coord.lng };
        const isInKarnataka = checkIfInKarnataka(coord.lat, coord.lng);
        
        setSelectedCoord(coordObj);
        setIsLocationInKarnataka(isInKarnataka);
        setLocationMethod('manual');
        
        // Get place name
        getAddressFromCoords(coord.lat, coord.lng).then(address => {
          setSelectedPlaceName(address);
        });
        
      } else if (msg.type === "outsideKarnatakaClick") {
        // Just update UI state, no alert
        setIsLocationInKarnataka(false);
        
      } else if (msg.type === "mapLoaded") {
        setIsLoadingMap(false);
      }
    } catch (err) {
      console.error("WebView message error:", err);
    }
  };

  // Reset view to Karnataka bounds
  const resetToKarnatakaView = () => {
    if (webViewRef.current) {
      webViewRef.current.postMessage(
        JSON.stringify({ type: "setKarnatakaView" })
      );
    }
  };

  // Toggle search bar visibility
  const toggleSearchBar = () => {
    setShowSearchBar(!showSearchBar);
    if (!showSearchBar) {
      // Clear search when showing search bar
      setSearchQuery("");
      setSearchResults([]);
    }
  };

  // Clear selection
  const handleClearSelection = () => {
    setSelectedCoord(null);
    setSearchQuery("");
    setSelectedPlaceName("");
    setLocationMethod(null);
    setIsLocationInKarnataka(true);
    setSearchResults([]);
  };

  // Clear search
  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults([]);
  };

  // Focus search
  const focusSearch = () => {
    setIsSearchFocused(true);
  };

  // Blur search
  const blurSearch = () => {
    setTimeout(() => {
      setIsSearchFocused(false);
    }, 200);
  };

  // Confirm selection
  const handleConfirm = () => {
    if (!selectedCoord) {
      Alert.alert("No Location", "Please select a location first.");
      return;
    }
    
    // FINAL VALIDATION
    const isInKarnataka = checkIfInKarnataka(
      selectedCoord.latitude, 
      selectedCoord.longitude
    );
    
    if (!isInKarnataka) {
      Alert.alert(
        "⚠️ Location Outside Karnataka",
        "This location is outside Karnataka. Please select a location within Karnataka for incident reporting.",
        [{ text: "OK" }]
      );
      return;
    }
    
    // Prepare location data
    const locationData = {
      ...selectedCoord,
      method: locationMethod,
      placeName: selectedPlaceName || searchQuery || null,
      timestamp: new Date().toISOString(),
      isInKarnataka: true
    };
    
    onLocationSelected(locationData);
  };

  // Re-center to current location
  const reCenterToCurrentLocation = () => {
    if (userLocation) {
      if (webViewRef.current) {
        webViewRef.current.postMessage(
          JSON.stringify({ 
            type: "centerMap", 
            coord: { lat: userLocation.latitude, lng: userLocation.longitude }
          })
        );
      }
    } else {
      getCurrentLocation();
    }
  };

  // Get icon for location type
  const getIconForType = (iconType) => {
    switch (iconType) {
      case 'business': return 'business';
      case 'road': return 'road';
      case 'leaf': return 'leaf';
      case 'camera': return 'camera';
      default: return 'location-outline';
    }
  };

  return (
    <>
      <AppHeader 
        title="Select Location"
        showBack={true}
        onBack={onClose}
        variant="dark"
        showProfile={false}
      />
      
      <View style={styles.container}>
        {/* SEARCH BAR */}
        {showSearchBar && (
          <View style={styles.searchContainer}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={20} color="#999" />
              <TextInput
                placeholder="Search locations in Karnataka..."
                value={searchQuery}
                onChangeText={(text) => {
                  setSearchQuery(text);
                  searchLocation(text);
                }}
                style={styles.searchInput}
                placeholderTextColor="#999"
                autoFocus={false}
                onFocus={focusSearch}
                onBlur={blurSearch}
              />
              {isLoading ? (
                <ActivityIndicator size="small" color="#8B133E" style={{ marginRight: 8 }} />
              ) : searchQuery.length > 0 ? (
                <TouchableOpacity onPress={clearSearch}>
                  <Ionicons name="close-circle" size={20} color="#999" />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* SEARCH RESULTS */}
            {(isSearchFocused || searchResults.length > 0) && (
              <View style={styles.resultsContainer}>
                {isLoading && searchResults.length === 0 ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color="##29011b" />
                    <Text style={styles.loadingText}>Searching Karnataka locations...</Text>
                  </View>
                ) : searchResults.length > 0 ? (
                  <FlatList
                    data={searchResults}
                    keyExtractor={(item) => item.properties.place_id || Math.random().toString()}
                    renderItem={({ item }) => {
                      const props = item.properties;
                      const isKarnataka = props.is_karnataka;
                      
                      return (
                        <TouchableOpacity
                          style={styles.resultItem}
                          onPress={() => handleSelectSearchResult(item)}
                        >
                          <Ionicons 
                            name={getIconForType(props.icon_type)} 
                            size={20} 
                            color={isKarnataka ? "#4CAF50" : "#ff9800"} 
                          />
                          <View style={styles.resultTextContainer}>
                            <Text style={styles.resultTitle} numberOfLines={1}>
                              {props.name || props.street || props.city || "Location"}
                            </Text>
                            <Text style={styles.resultSubtext} numberOfLines={2}>
                              {props.display_text}
                            </Text>
                            <View style={styles.resultMeta}>
                              <Text style={styles.resultType}>
                                {props.city ? `${props.city}` : ''}
                                {props.district && props.district !== props.city ? ` • ${props.district}` : ''}
                              </Text>
                              {isKarnataka ? (
                                <View style={styles.karnatakaBadge}>
                                  <Ionicons name="checkmark" size={10} color="#fff" />
                                  <Text style={styles.karnatakaBadgeText}>KA</Text>
                                </View>
                              ) : (
                                <Text style={styles.otherStateText}>
                                  {props.state || 'Outside KA'}
                                </Text>
                              )}
                            </View>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color="#ccc" />
                        </TouchableOpacity>
                      );
                    }}
                    style={{ maxHeight: 350 }}
                    keyboardShouldPersistTaps="handled"
                  />
                ) : searchQuery.length >= 2 ? (
                  <View style={styles.noResults}>
                    <Ionicons name="search-outline" size={32} color="#ccc" />
                    <Text style={styles.noResultsTitle}>No locations found in Karnataka</Text>
                    <Text style={styles.noResultsText}>
                      Try searching for cities like "Bangalore", "Mysore", etc.
                    </Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>
        )}

        {/* MAP SECTION */}
        <View style={styles.mapSection}>
          {/* FLOATING ACTION BUTTONS */}
          <View style={styles.floatingButtonsContainer}>
            {/* SEARCH TOGGLE BUTTON */}
            <TouchableOpacity
              onPress={toggleSearchBar}
              style={styles.floatingButton}
            >
              <Ionicons 
              name={showSearchBar ? "close" : "search"} 
              size={22} 
              color="#fff" 
            />
            </TouchableOpacity>

            {/* CURRENT LOCATION BUTTON */}
            <TouchableOpacity
              onPress={reCenterToCurrentLocation}
              style={styles.floatingButton}
            >
              <Ionicons 
                name="locate" 
                size={22} 
                color="#fff" 
              />
            </TouchableOpacity>

            {/* RESET KARNATAKA VIEW BUTTON */}
            <TouchableOpacity
              onPress={resetToKarnatakaView}
              style={styles.floatingButton}
            >
              <Ionicons name="globe-outline" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* WEBVIEW MAP */}
          <View style={styles.mapContainer}>
            {isLoadingMap && (
              <View style={styles.mapLoading}>
                <ActivityIndicator size="large" color="#29011b" />
                <Text style={styles.mapLoadingText}>Loading Karnataka map...</Text>
              </View>
            )}
            
            <WebView
              ref={webViewRef}
              source={{ html: htmlContent }}
              onMessage={handleWebViewMessage}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              style={styles.map}
              originWhitelist={["*"]}
              mixedContentMode="compatibility"
              onLoadEnd={() => setIsLoadingMap(false)}
              onError={(error) => {
                console.error('WebView error:', error);
                Alert.alert("Map Error", "Failed to load map.");
              }}
            />
          </View>
        </View>

        {/* SELECTED LOCATION INFO */}
        {selectedCoord && (
          <View style={styles.selectedInfo}>
            <View style={[
              styles.coordsBox,
              !isLocationInKarnataka && styles.coordsBoxWarning
            ]}>
              <View style={styles.coordsHeader}>
                <Ionicons 
                  name={locationMethod === 'live' ? "location" : 
                        locationMethod === 'search' ? "search" : "pin"} 
                  size={24} 
                  color={isLocationInKarnataka ? "#4CAF50" : "#ff4444"} 
                />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.coordsLabel}>
                    {locationMethod === 'live' ? 'Current Location' : 
                     locationMethod === 'search' ? 'Searched Location' : 
                     'Selected Location'}
                  </Text>
                  <Text style={styles.coordsText}>
                    {selectedCoord.latitude.toFixed(6)}, {selectedCoord.longitude.toFixed(6)}
                  </Text>
                  {selectedPlaceName && (
                    <Text style={styles.placeNameText} numberOfLines={2}>
                      {selectedPlaceName}
                    </Text>
                  )}
                  <View style={styles.locationStatus}>
                    {isLocationInKarnataka ? (
                      <View style={styles.inKarnatakaStatus}>
                        <Ionicons name="checkmark-circle" size={14} color="#4CAF50" />
                        <Text style={styles.inKarnatakaText}>✓ Within Karnataka</Text>
                        <View style={styles.verifiedBadge}>
                          <Text style={styles.verifiedBadgeText}>Verified</Text>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.outsideKarnatakaStatus}>
                        <Ionicons name="warning" size={14} color="#ff4444" />
                        <Text style={styles.outsideKarnatakaText}>⚠️ Outside Karnataka - Cannot Report</Text>
                      </View>
                    )}
                  </View>
                </View>
                <TouchableOpacity onPress={handleClearSelection} style={styles.clearButton}>
                  <Ionicons name="close-circle" size={22} color="#ff4444" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* CONFIRM BUTTON */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[
              styles.confirmButton,
              (!selectedCoord || !isLocationInKarnataka) && styles.confirmButtonDisabled,
            ]}
            disabled={!selectedCoord || !isLocationInKarnataka}
            onPress={handleConfirm}
          >
            <Ionicons name="checkmark-circle" size={24} color="#fff" />
            <Text style={styles.confirmText}>
              {!selectedCoord ? "Select a Location" :
               !isLocationInKarnataka ? "Location Outside Karnataka" :
               "Confirm Karnataka Location"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  searchContainer: {
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e9ecef",
    zIndex: 100,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8f9fa",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dee2e6",
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    marginLeft: 10,
    marginRight: 10,
    color: "#333",
    padding: 0,
  },
  resultsContainer: {
    backgroundColor: "#fff",
    borderRadius: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#dee2e6",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    maxHeight: 350,
    zIndex: 1000,
  },
  loadingContainer: {
    padding: 20,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: {
    color: "#666",
    fontSize: 14,
  },
  resultItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f3f5",
  },
  resultTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  resultTitle: {
    fontSize: 14,
    color: "#333",
    fontWeight: "600",
    marginBottom: 2,
  },
  resultSubtext: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  resultMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  resultType: {
    fontSize: 11,
    color: "#888",
    fontWeight: "500",
  },
  karnatakaBadge: {
    backgroundColor: "#4CAF50",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  karnatakaBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "bold",
  },
  otherStateText: {
    fontSize: 10,
    color: "#ff9800",
    fontWeight: "600",
  },
  noResults: {
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  noResultsTitle: {
    fontSize: 16,
    color: "#999",
    fontWeight: "600",
    marginTop: 8,
    marginBottom: 4,
  },
  noResultsText: {
    fontSize: 14,
    color: "#999",
    textAlign: 'center',
  },
  mapSection: {
    flex: 1,
    position: 'relative',
  },
  floatingButtonsContainer: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 100,
    gap: 12,
  },
  floatingButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(139, 19, 62, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  mapLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    zIndex: 10,
  },
  mapLoadingText: {
    marginTop: 10,
    fontSize: 14,
    color: '#666',
  },
  selectedInfo: {
    padding: 16,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e9ecef",
  },
  coordsBox: {
    backgroundColor: "#f8f9fa",
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e9ecef",
  },
  coordsBoxWarning: {
    backgroundColor: "#FFF5F5",
    borderColor: "#FFCDD2",
  },
  coordsHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  coordsLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 4,
  },
  coordsText: {
    fontSize: 13,
    color: "#666",
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 4,
  },
  placeNameText: {
    fontSize: 12,
    color: "#888",
    marginBottom: 8,
  },
  locationStatus: {
    marginTop: 4,
  },
  inKarnatakaStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  inKarnatakaText: {
    fontSize: 12,
    color: "#4CAF50",
    fontWeight: "600",
  },
  verifiedBadge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 6,
  },
  verifiedBadgeText: {
    fontSize: 10,
    color: '#2E7D32',
    fontWeight: '600',
  },
  outsideKarnatakaStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  outsideKarnatakaText: {
    fontSize: 12,
    color: "#ff4444",
    fontWeight: "600",
  },
  clearButton: {
    padding: 4,
  },
  bottomBar: {
    padding: 16,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e9ecef",
  },
  confirmButton: {
    backgroundColor: "#29011b",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 10,
  },
  confirmButtonDisabled: {
    backgroundColor: "#ccc",
  },
  confirmText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
});