import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Platform,
  Linking,
  Modal,
  TextInput,
  AppState
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LineChart } from "react-native-chart-kit";
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Share from 'react-native-share';
import WebMapComponent from "../components/WebMapComponent";
import { BASE_URL } from "../utils/config";

const { width } = Dimensions.get('window');

export default function RouteDetailsScreen({ navigation, route }) {
  const { start, end, locationName } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [routeInfo, setRouteInfo] = useState(null);
  const [safetyScore, setSafetyScore] = useState(0);
  const [incidentCount, setIncidentCount] = useState(0);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState("User");
  
  // Live Location State
  const [liveLocationModalVisible, setLiveLocationModalVisible] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState(30);
  const [customDuration, setCustomDuration] = useState("");
  const [isSharingLiveLocation, setIsSharingLiveLocation] = useState(false);
  const [liveLocationSessionId, setLiveLocationSessionId] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [liveTrackingInterval, setLiveTrackingInterval] = useState(null);
  const [locationUpdatesCount, setLocationUpdatesCount] = useState(0);
  
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    if (start && end) {
      calculateRoute();
    }
    loadUserData();
    getCurrentLocation();
    checkActiveTrackingSession();
    
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      if (liveTrackingInterval) {
        clearInterval(liveTrackingInterval);
      }
      subscription.remove();
    };
  }, [start, end]);

  const handleAppStateChange = (nextAppState) => {
    if (
      appState.current.match(/inactive|background/) &&
      nextAppState === 'active' &&
      isSharingLiveLocation
    ) {
      startLocationUpdates();
    }
    appState.current = nextAppState;
  };

  const checkActiveTrackingSession = async () => {
    try {
      const activeSession = await AsyncStorage.getItem('active_tracking_session');
      if (activeSession) {
        const sessionData = JSON.parse(activeSession);
        setLiveLocationSessionId(sessionData.session_id);
        setIsSharingLiveLocation(true);
        setSelectedDuration(sessionData.duration_minutes || 30);
        
        if (sessionData.expires_at && new Date(sessionData.expires_at) < new Date()) {
          await stopLiveLocationSharing();
        } else {
          startLocationUpdates();
        }
      }
    } catch (error) {
      console.error('Error checking active session:', error);
    }
  };

  const loadUserData = async () => {
    try {
      const storedUser = await AsyncStorage.getItem("userData");
      if (storedUser) {
        const userData = JSON.parse(storedUser);
        setUserId(userData.id);
        setUserName(userData.name || userData.email?.split('@')[0] || "User");
      }
    } catch (error) {
      console.error("Error loading user data:", error);
    }
  };

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        Alert.alert(
          "Location Required",
          "Please enable location for route calculation.",
          [{ text: "OK" }]
        );
        return null;
      }
  
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      
      setCurrentLocation({
        lat: location.coords.latitude,
        lng: location.coords.longitude
      });
      
      return location;
      
    } catch (error) {
      console.error("Error getting location:", error);
      return null;
    }
  };

  const startLocationUpdates = async () => {
  try {
    // Only use foreground location (no background)
    const interval = setInterval(async () => {
      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        
        if (liveLocationSessionId) {
          await fetch(`${BASE_URL}/update_location/${liveLocationSessionId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              timestamp: new Date().toISOString(),
            }),
          });
          
          setLocationUpdatesCount(prev => prev + 1);
          setCurrentLocation({
            lat: location.coords.latitude,
            lng: location.coords.longitude
          });
        }
      } catch (error) {
        console.error("Location update error:", error);
      }
    }, 30000);
    
    setLiveTrackingInterval(interval);
    
    // Send initial update
    await sendLocationUpdate();
    
  } catch (error) {
    console.error("Error starting location updates:", error);
  }
};

const sendLocationUpdate = async () => {
  try {
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    
    if (liveLocationSessionId) {
      await fetch(`${BASE_URL}/update_location/${liveLocationSessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          timestamp: new Date().toISOString(),
        }),
      });
      
      setLocationUpdatesCount(prev => prev + 1);
      setCurrentLocation({
        lat: location.coords.latitude,
        lng: location.coords.longitude
      });
    }
  } catch (error) {
    console.error("Location update error:", error);
  }
};

  const calculateRoute = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${BASE_URL}/safe_route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, end }),
      });

      const data = await response.json();
      
      if (data.success && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        setRouteInfo(route);
        
        const score = Math.max(0, 100 - (route.total_risk * 10));
        setSafetyScore(Math.min(100, score));
        setIncidentCount(route.total_risk);
      } else {
        Alert.alert("No Route Found", "Could not calculate a safe route.");
        setRouteInfo({
          distance: 0,
          duration: 0,
          total_risk: 0,
          coords: []
        });
      }
    } catch (error) {
      console.error("Route error:", error);
      Alert.alert("Error", "Unable to calculate route. Please try again.");
      setRouteInfo({
        distance: 0,
        duration: 0,
        total_risk: 0,
        coords: []
      });
    } finally {
      setLoading(false);
    }
  };

  const openLiveLocationModal = () => {
    setLiveLocationModalVisible(true);
    getCurrentLocation();
  };

  const startLiveLocationSharing = async (durationMinutes) => {
    setLiveLocationModalVisible(false);
    
    try {
      if (!currentLocation) {
        await getCurrentLocation();
        if (!currentLocation) {
          Alert.alert("Error", "Unable to get current location.");
          return;
        }
      }

      const sessionData = await createTrackingSession(durationMinutes);
      if (!sessionData) {
        Alert.alert("Error", "Failed to create tracking session");
        return;
      }

      setLiveLocationSessionId(sessionData.session_id);
      setIsSharingLiveLocation(true);
      
      await AsyncStorage.setItem('active_tracking_session', JSON.stringify({
        session_id: sessionData.session_id,
        tracking_url: sessionData.tracking_url,
        duration_minutes: durationMinutes,
        expires_at: sessionData.expires_at,
        started_at: new Date().toISOString(),
        last_location: currentLocation
      }));

      await startLocationUpdates();
      
      showSharingOptions(sessionData.tracking_url, durationMinutes);
      
      if (durationMinutes > 0) {
        setTimeout(() => {
          Alert.alert(
            "Live Location Ended",
            `Your ${durationMinutes}-minute live location sharing has ended.`,
            [{ text: "OK", onPress: () => stopLiveLocationSharing() }]  
          );
        }, durationMinutes * 60 * 1000);
      }
      
    } catch (error) {
      console.error("Error starting live sharing:", error);
      Alert.alert("Error", "Unable to start live location sharing");
    }
  };

  const createTrackingSession = async (durationMinutes) => {
    try {
      const response = await fetch(`${BASE_URL}/create_tracking_session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          user_name: userName,
          latitude: currentLocation.lat,
          longitude: currentLocation.lng,
          duration_minutes: durationMinutes,
        }),
      });
  
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // FIX: Ensure tracking URL is complete
          let trackingUrl = data.tracking_url;
          
          // If URL is malformed (like http:///track/sessionid)
          if (trackingUrl.startsWith('http:///')) {
            // Extract the server IP from BASE_URL
            const serverBase = BASE_URL.replace('http://', '').split(':')[0];
            trackingUrl = `http://${serverBase}:5000/track/${data.session_id}`;
          }
          
          // Also ensure WebSocket URL is correct
          if (data.webSocket_url && data.webSocket_url.startsWith('ws:///')) {
            const serverBase = BASE_URL.replace('http://', '').split(':')[0];
            data.webSocket_url = `ws://${serverBase}:5000`;
          }
          
          return {
            ...data,
            tracking_url: trackingUrl
          };
        }
      }
      return null;
    } catch (error) {
      console.error("Create session error:", error);
      return null;
    }
  };

  const stopLiveLocationSharing = async () => {
    try {
      if (liveLocationSessionId) {
        await fetch(`${BASE_URL}/stop_tracking_session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: liveLocationSessionId }),
        });
      }
    } catch (error) {
      console.error("Error stopping tracking:", error);
    } finally {
      // Clear interval
      if (liveTrackingInterval) {
        clearInterval(liveTrackingInterval);
        setLiveTrackingInterval(null);
      }
      
      // Clear local storage
      try {
        await AsyncStorage.removeItem('active_tracking_session');
      } catch (storageError) {
        console.error("Error clearing storage:", storageError);
      }
      
      // Reset state
      setLiveLocationSessionId(null);
      setIsSharingLiveLocation(false);
      setLocationUpdatesCount(0);
      
      Alert.alert("Success", "Live location sharing stopped");
    }
  };

  const showSharingOptions = (trackingUrl, durationMinutes) => {
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    let durationText = "";
    
    if (hours > 0 && minutes > 0) {
      durationText = `${hours}h ${minutes}min`;
    } else if (hours > 0) {
      durationText = `${hours}h`;
    } else if (durationMinutes === 0) {
      durationText = "until manually stopped";
    } else {
      durationText = `${minutes}min`;
    }
  
    // Get current location for map link
    const mapLink = currentLocation 
      ? `https://www.google.com/maps?q=${currentLocation.lat},${currentLocation.lng}`
      : "Location pending...";
  
    // Enhanced message with both tracking link AND map link
    const message = `📍 *HerShield Live Location*
  
  *${userName}* is sharing live location
  
  *Live Tracking Link:*
  ${trackingUrl}
  
  *Quick Map View:*
  ${mapLink}
  
  *Duration:* ${durationText}
  *Live Updates:* Every 30 seconds
  
  _Shared via HerShield App_`;
  
    // Alternative simpler version if the above doesn't work
    const alternativeMessage = `📍 HerShield Live Location
  
  ${userName} is sharing live location
  
  🔗 Track live location:
  ${trackingUrl}
  
  🗺️ View on Google Maps:
  ${mapLink}
  
  ⏱️ Duration: ${durationText}
  🔄 Updates every 30 seconds
  
  _Shared via HerShield App_`;
  
    Alert.alert(
      "Share Live Location",
      "Choose sharing method:",
      [
        {
          text: "WhatsApp",
          onPress: () => shareViaWhatsApp(alternativeMessage, trackingUrl)
        },
        {
          text: "SMS",
          onPress: () => shareViaSMS(alternativeMessage, mapLink)
        },
        {
          text: "Any App",
          onPress: () => shareViaAnyApp(alternativeMessage, trackingUrl)
        },
        {
          text: "Copy Link",
          onPress: () => copyToClipboard(trackingUrl)
        },
        {
          text: "Skip",
          style: "cancel"
        }
      ]
    );
  };

  const shareViaWhatsApp = async (message, url) => {
    try {
      const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;
      
      const canOpen = await Linking.canOpenURL(whatsappUrl);
      if (canOpen) {
        await Linking.openURL(whatsappUrl);
      } else {
        await Share.open({
          title: 'HerShield Live Location',
          message: message,
          url: url,
        });
      }
    } catch (error) {
      console.error("Error sharing via WhatsApp:", error);
      Alert.alert("Error", "WhatsApp not available. Using default sharing.");
      shareViaAnyApp(message, url);
    }
  };

  const shareViaSMS = async (message, mapLink) => {
    try {
      const smsUrl = `sms:?body=${encodeURIComponent(message)}`;
      
      const canOpen = await Linking.canOpenURL(smsUrl);
      if (canOpen) {
        await Linking.openURL(smsUrl);
      } else {
        Alert.alert("SMS", "Message copied to clipboard");
        // Fallback to clipboard
        const Clipboard = require('@react-native-clipboard/clipboard').default;
        Clipboard.setString(message);
      }
    } catch (error) {
      console.error("Error sending SMS:", error);
      // Fallback to share sheet
      shareViaAnyApp(message, mapLink || trackingUrl);
    }
  };

  const shareViaAnyApp = async (message, url) => {
    try {
      const shareOptions = {
        title: 'HerShield Live Location',
        message: message,
        url: url,
      };

      await Share.open(shareOptions);
    } catch (error) {
      console.error("Error sharing:", error);
      Alert.alert("Error", "Unable to share");
    }
  };

  const copyToClipboard = async (url) => {
    try {
      const Clipboard = require('@react-native-clipboard/clipboard').default;
      Clipboard.setString(url);
      Alert.alert("Copied!", "Tracking link copied to clipboard");
    } catch (error) {
      console.error("Copy error:", error);
      Alert.alert("Error", "Could not copy to clipboard");
    }
  };
  const generateMapLink = (lat, lng) => {
    if (!lat || !lng) return "Location pending...";
    return `https://maps.google.com/?q=${lat},${lng}`;
    // OR for Apple Maps: return `https://maps.apple.com/?ll=${lat},${lng}`;
  };
  
  // Then use it in your message:
  const mapLink = generateMapLink(currentLocation?.lat, currentLocation?.lng);
  const shareRoute = async () => {
    if (!routeInfo) {
      Alert.alert("Error", "No route information available");
      return;
    }

    try {
      const osmUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_walk&route=${start.lat},${start.lng};${end.lat},${end.lng}`;
      
      const message = `🚶‍♀️ *HerShield Route Sharing*\n\n📍 **From:** Current Location\n📍 **To:** ${locationName || "Destination"}\n📏 **Distance:** ${routeInfo.distance || 0} km\n⏱️ **Duration:** ${routeInfo.duration || 0} minutes\n🛡️ **Safety Score:** ${safetyScore}/100\n\n🗺️ View route:\n${osmUrl}\n\n_Shared via HerShield App_`;
      
      const shareOptions = {
        title: 'Share Route',
        message: message,
        url: osmUrl,
      };

      await Share.share(shareOptions);
      
    } catch (error) {
      console.error("Error sharing route:", error);
      Alert.alert("Error", "Unable to share route");
    }
  };

  const shareRouteViaWhatsApp = () => {
    if (!routeInfo) {
      Alert.alert("Error", "No route information available");
      return;
    }

    const osmUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_walk&route=${start.lat},${start.lng};${end.lat},${end.lng}`;
    
    const message = `🚶‍♀️ *HerShield Route Sharing*\n\n📍 **To:** ${locationName || "Destination"}\n📏 **Distance:** ${routeInfo.distance || 0} km\n⏱️ **Duration:** ${routeInfo.duration || 0} minutes\n🛡️ **Safety Score:** ${safetyScore}/100\n\n🗺️ View route on OpenStreetMap:\n${osmUrl}\n\n_Shared via HerShield App_`;

    const url = `whatsapp://send?text=${encodeURIComponent(message)}`;
    
    Linking.canOpenURL(url).then(supported => {
      if (supported) {
        Linking.openURL(url);
      } else {
        Share.share({
          title: 'Share Route',
          message: message,
          url: osmUrl,
        });
      }
    }).catch(err => console.error('Error opening WhatsApp:', err));
  };

  const startNavigation = () => {
    if (routeInfo) {
      navigation.navigate("Navigation", {
        route: routeInfo,
        start,
        end,
        locationName
      });
    }
  };

  const getSafetyColor = (score) => {
    if (score >= 80) return "#4CAF50";
    if (score >= 60) return "#FF9800";
    return "#F44336";
  };

  const getSafetyLevel = (score) => {
    if (score >= 80) return "Very Safe";
    if (score >= 60) return "Moderately Safe";
    if (score >= 40) return "Some Risks";
    return "High Risk";
  };

  const renderMap = () => {
    const routeCoords = routeInfo?.coords?.map(coord => ({
      latitude: coord.latitude,
      longitude: coord.longitude
    })) || [];

    return (
      <WebMapComponent
        startLocation={start ? { 
          latitude: start.lat, 
          longitude: start.lng,
          title: "Start" 
        } : null}
        endLocation={end ? { 
          latitude: end.lat, 
          longitude: end.lng,
          title: locationName || "Destination"
        } : null}
        routeCoordinates={routeCoords}
        showUserLocation={true}
        style={styles.mapContainer}
      />
    );
  };

  const durationOptions = [
    { label: "15 minutes", value: 15 },
    { label: "30 minutes", value: 30 },
    { label: "1 hour", value: 60 },
    { label: "2 hours", value: 120 },
    { label: "Until I stop", value: 0 },
  ];

  // FIX: Check both loading AND routeInfo
  if (loading || !routeInfo) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#570a1c" />
        <Text style={styles.loadingText}>Calculating safest route...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Route Details</Text>
        
        {isSharingLiveLocation && (
          <View style={styles.liveIndicator}>
            <Ionicons name="radio-button-on" size={12} color="#FF0000" />
            <Text style={styles.liveText}>Live {locationUpdatesCount > 0 && `(${locationUpdatesCount})`}</Text>
          </View>
        )}
      </View>

      <View style={styles.mapSection}>
        {renderMap()}
      </View>

      <View style={styles.destinationCard}>
        <View style={styles.destinationHeader}>
          <Ionicons name="location" size={24} color="#570a1c" />
          <View style={styles.destinationTexts}>
            <Text style={styles.destinationTitle}>{locationName || "Destination"}</Text>
            <Text style={styles.destinationSubtitle}>
              {end ? `${end.lat.toFixed(4)}, ${end.lng.toFixed(4)}` : ""}
            </Text>
          </View>
        </View>
        
        <View style={styles.routeStats}>
          <View style={styles.statItem}>
            <Ionicons name="navigate" size={20} color="#666" />
            <Text style={styles.statValue}>{routeInfo?.distance || 0} km</Text>
            <Text style={styles.statLabel}>Distance</Text>
          </View>
          <View style={styles.statItem}>
            <Ionicons name="time" size={20} color="#666" />
            <Text style={styles.statValue}>{routeInfo?.duration || 0} min</Text>
            <Text style={styles.statLabel}>Time</Text>
          </View>
          <View style={styles.statItem}>
            <Ionicons name="warning" size={20} color="#666" />
            <Text style={styles.statValue}>{incidentCount}</Text>
            <Text style={styles.statLabel}>Risks</Text>
          </View>
        </View>
      </View>

      <View style={styles.safetyCard}>
        <Text style={styles.cardTitle}>Safety Score</Text>
        <View style={styles.safetyScoreContainer}>
          <View style={styles.scoreCircle}>
            <Text style={[styles.scoreText, { color: getSafetyColor(safetyScore) }]}>
              {safetyScore}
            </Text>
            <Text style={styles.scoreLabel}>/100</Text>
          </View>
          <View style={styles.safetyInfo}>
            <Text style={[styles.safetyLevel, { color: getSafetyColor(safetyScore) }]}>
              {getSafetyLevel(safetyScore)}
            </Text>
            <Text style={styles.safetyDescription}>
              {incidentCount > 0 
                ? `${incidentCount} risk zones detected and avoided`
                : "No risk zones detected along this route"}
            </Text>
          </View>
        </View>
        
        <View style={styles.chartContainer}>
          <LineChart
            data={{
              labels: ["", "", "", "", ""],
              datasets: [{
                data: [30, 50, 70, 85, safetyScore],
                color: () => getSafetyColor(safetyScore),
              }]
            }}
            width={width - 60}
            height={120}
            chartConfig={{
              backgroundColor: "#fff",
              backgroundGradientFrom: "#fff",
              backgroundGradientTo: "#fff",
              decimalPlaces: 0,
              color: () => getSafetyColor(safetyScore),
              labelColor: () => "#666",
              style: { borderRadius: 16 },
              propsForDots: {
                r: "6",
                strokeWidth: "2",
                stroke: "#fff"
              }
            }}
            bezier
            style={styles.chart}
          />
        </View>
      </View>

      <View style={styles.optionsCard}>
        <Text style={styles.cardTitle}>Sharing Options</Text>
        
        <TouchableOpacity style={styles.optionItem} onPress={startNavigation}>
          <View style={[styles.optionIcon, { backgroundColor: "#E3F2FD" }]}>
            <Ionicons name="navigate" size={24} color="#570a1c" />
          </View>
          <View style={styles.optionContent}>
            <Text style={styles.optionTitle}>Start Navigation</Text>
            <Text style={styles.optionSubtitle}>Turn-by-turn guidance with safety alerts</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#ccc" />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.optionItem} onPress={openLiveLocationModal}>
          <View style={[styles.optionIcon, { backgroundColor: "#FFEBEE" }]}>
            <Ionicons name="location" size={24} color="#F44336" />
          </View>
          <View style={styles.optionContent}>
            <Text style={styles.optionTitle}>Share Live Location</Text>
            <Text style={styles.optionSubtitle}>Share your real-time location</Text>
          </View>
          {isSharingLiveLocation && (
            <View style={styles.activeDot}>
              <Ionicons name="radio-button-on" size={12} color="#FF0000" />
            </View>
          )}
          <Ionicons name="chevron-forward" size={20} color="#ccc" />
        </TouchableOpacity>
      </View>

      <View style={styles.infoCard}>
        <Ionicons name="information-circle" size={24} color="#2196F3" />
        <View style={styles.infoContent}>
          <Text style={styles.infoTitle}>About Live Location Sharing</Text>
          <Text style={styles.infoText}>
            • Choose duration: 15 min, 30 min, 1 hr, 2 hr, or manual stop{"\n"}
            • Share via WhatsApp, SMS, or any messaging app{"\n"}
            • Recipients see your location on an interactive map{"\n"}
            • You can stop sharing anytime
          </Text>
        </View>
      </View>
      
      <Modal
        animationType="slide"
        transparent={true}
        visible={liveLocationModalVisible}
        onRequestClose={() => setLiveLocationModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {isSharingLiveLocation ? "Live Location Active" : "Share Live Location"}
              </Text>
              <TouchableOpacity 
                onPress={() => setLiveLocationModalVisible(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            {isSharingLiveLocation ? (
              <View style={styles.activeSessionView}>
                <Ionicons name="radio-button-on" size={40} color="#4CAF50" />
                <Text style={styles.activeSessionTitle}>Live Location Active</Text>
                <Text style={styles.activeSessionText}>
                  You're sharing your location every 30 seconds
                </Text>
                <Text style={styles.locationUpdates}>
                  Updates sent: {locationUpdatesCount}
                </Text>
                
                <TouchableOpacity
                  style={styles.stopSharingButton}
                  onPress={() => {
                    stopLiveLocationSharing();
                    setLiveLocationModalVisible(false);
                  }}
                >
                  <Ionicons name="stop-circle" size={20} color="#fff" />
                  <Text style={styles.stopSharingText}>Stop Live Sharing</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.modalSubtitle}>Select sharing duration:</Text>
                
                {durationOptions.map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.durationOption,
                      selectedDuration === option.value && styles.durationOptionSelected
                    ]}
                    onPress={() => {
                      setSelectedDuration(option.value);
                      startLiveLocationSharing(option.value);
                    }}
                  >
                    <Text style={[
                      styles.durationText,
                      selectedDuration === option.value && styles.durationTextSelected
                    ]}>
                      {option.label}
                    </Text>
                    {selectedDuration === option.value && (
                      <Ionicons name="checkmark" size={20} color="#570a1c" />
                    )}
                  </TouchableOpacity>
                ))}
                
                <View style={styles.customDurationContainer}>
                  <TextInput
                    style={styles.customDurationInput}
                    placeholder="Custom minutes (e.g., 45)"
                    keyboardType="numeric"
                    value={customDuration}
                    onChangeText={setCustomDuration}
                    placeholderTextColor="#999"
                  />
                  <TouchableOpacity
                    style={[
                      styles.customDurationButton,
                      !customDuration && styles.customDurationButtonDisabled
                    ]}
                    onPress={() => {
                      if (customDuration && !isNaN(customDuration) && parseInt(customDuration) > 0) {
                        startLiveLocationSharing(parseInt(customDuration));
                      } else {
                        Alert.alert("Invalid Input", "Please enter a valid number of minutes");
                      }
                    }}
                    disabled={!customDuration}
                  >
                    <Text style={styles.customDurationButtonText}>Set</Text>
                  </TouchableOpacity>
                </View>
                
                <View style={styles.modalNoteContainer}>
                  <Ionicons name="information-circle" size={16} color="#666" />
                  <Text style={styles.modalNote}>
  Location updates every 30 seconds when app is open. Recipients see real-time updates.
</Text>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: "#666",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 50,
    paddingBottom: 15,
    paddingHorizontal: 20,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  backButton: {
    padding: 5,
    marginRight: 15,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    flex: 1,
  },
  liveIndicator: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFEBEE",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  liveText: {
    fontSize: 12,
    color: "#F44336",
    marginLeft: 4,
    fontWeight: "600",
  },
  mapSection: {
    height: 250,
    margin: 15,
    borderRadius: 15,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  mapContainer: {
    flex: 1,
    borderRadius: 15,
  },
  destinationCard: {
    backgroundColor: "#fff",
    margin: 15,
    borderRadius: 15,
    padding: 20,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  destinationHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  destinationTexts: {
    flex: 1,
    marginLeft: 15,
  },
  destinationTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 3,
  },
  destinationSubtitle: {
    fontSize: 14,
    color: "#666",
  },
  routeStats: {
    flexDirection: "row",
    justifyContent: "space-around",
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    paddingTop: 20,
  },
  statItem: {
    alignItems: "center",
  },
  statValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#570a1c",
    marginTop: 5,
  },
  statLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  safetyCard: {
    backgroundColor: "#fff",
    marginHorizontal: 15,
    marginBottom: 15,
    borderRadius: 15,
    padding: 20,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 15,
  },
  safetyScoreContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  scoreCircle: {
    alignItems: "center",
    justifyContent: "center",
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: "#f0f0f0",
    marginRight: 20,
  },
  scoreText: {
    fontSize: 24,
    fontWeight: "700",
  },
  scoreLabel: {
    fontSize: 14,
    color: "#999",
  },
  safetyInfo: {
    flex: 1,
  },
  safetyLevel: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 5,
  },
  safetyDescription: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
  chartContainer: {
    marginTop: 10,
  },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
  },
  optionsCard: {
    backgroundColor: "#fff",
    marginHorizontal: 15,
    marginBottom: 15,
    borderRadius: 15,
    padding: 20,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  optionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f5",
  },
  optionIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 15,
  },
  optionContent: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
    marginBottom: 3,
  },
  optionSubtitle: {
    fontSize: 14,
    color: "#666",
  },
  activeDot: {
    marginRight: 10,
  },
  infoCard: {
    flexDirection: "row",
    backgroundColor: "#E3F2FD",
    marginHorizontal: 15,
    marginBottom: 15,
    borderRadius: 10,
    padding: 15,
    alignItems: "flex-start",
  },
  infoContent: {
    flex: 1,
    marginLeft: 10,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1976D2",
    marginBottom: 5,
  },
  infoText: {
    fontSize: 12,
    color: "#1976D2",
    lineHeight: 18,
  },
  navigationButton: {
    backgroundColor: "#570a1c",
    marginHorizontal: 15,
    marginBottom: 30,
    borderRadius: 25,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
    shadowColor: "#570a1c",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  navButtonIcon: {
    marginRight: 10,
  },
  navigationButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
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
    paddingHorizontal: 20,
    paddingBottom: 30,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  modalCloseButton: {
    padding: 5,
  },
  modalSubtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 20,
    marginBottom: 15,
  },
  durationOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  durationOptionSelected: {
    backgroundColor: '#570a1c10',
    borderColor: '#570a1c',
  },
  durationText: {
    fontSize: 16,
    color: '#333',
  },
  durationTextSelected: {
    color: '#570a1c',
    fontWeight: '500',
  },
  customDurationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 15,
  },
  customDurationInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 16,
    marginRight: 10,
    color: '#333',
  },
  customDurationButton: {
    backgroundColor: '#570a1c',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  customDurationButtonDisabled: {
    backgroundColor: '#cccccc',
  },
  customDurationButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  modalNoteContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 8,
    marginTop: 20,
  },
  modalNote: {
    flex: 1,
    fontSize: 12,
    color: '#666',
    marginLeft: 10,
    lineHeight: 16,
  },
  activeSessionView: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  activeSessionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginTop: 10,
  },
  activeSessionText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 20,
  },
  locationUpdates: {
    fontSize: 16,
    fontWeight: '600',
    color: '#570a1c',
    marginTop: 20,
    marginBottom: 30,
  },
  stopSharingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F44336',
    paddingVertical: 15,
    borderRadius: 10,
    marginTop: 20,
  },
  stopSharingText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 10,
  },
});