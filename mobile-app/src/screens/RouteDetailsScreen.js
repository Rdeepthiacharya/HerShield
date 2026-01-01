import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
  AppState,
  Share
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LineChart } from "react-native-chart-kit";
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from "../utils/config";
import Clipboard from '@react-native-clipboard/clipboard';
import AppHeader from "../components/AppHeader";
import { useToast } from "../context/ToastContext";

const { width, height } = Dimensions.get('window');


const SPEEDS = {
  walk: 4.0,
  vehicle: 20.0,
};

const getLast6Months = () => {
  const now = new Date();
  const months = [];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);

    const monthIndex = d.getMonth();
    const monthName = monthNames[monthIndex];
    const year = d.getFullYear();

    months.push(`${monthName} ${year}`);
  }

  console.log("Manual labels:", months);
  return months;
};

const generateSafetyTrend = (currentScore) => {
  const base = Math.max(60, currentScore - 15);
  const values = [
    base - 2,
    base - 1,
    base,
    base + 1,
    base + 3,
    currentScore
  ];
  return values.map(v => Math.max(0, Math.min(100, v)));
};



export default function RouteDetailsScreen({ onClose, navigation, route }) {
  const { start, end, locationName } = route.params || {};
  const [loading, setLoading] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const [safetyScore, setSafetyScore] = useState(100);
  const [incidentCount, setIncidentCount] = useState(0);
  const [routeCache, setRouteCache] = useState({});
  const [routeLoading, setRouteLoading] = useState(false);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState("User");
  const [userFullName, setUserFullName] = useState("");
  const [mode, setMode] = useState("walk");
  const lastRouteRef = useRef(null);


  // Live Location State
  const [liveLocationModalVisible, setLiveLocationModalVisible] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState(30);
  const [customDuration, setCustomDuration] = useState("");
  const [isSharingLiveLocation, setIsSharingLiveLocation] = useState(false);
  const [liveLocationSessionId, setLiveLocationSessionId] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [locationUpdatesCount, setLocationUpdatesCount] = useState(0);
  const [address, setAddress] = useState("Getting your location...");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [sessionStartTime, setSessionStartTime] = useState("");
  const appState = useRef(AppState.currentState);

  // Toast hook with fallback
  let showToast;
  try {
    const toastContext = useToast();
    showToast = toastContext.showToast;
  } catch (error) {
    console.warn("ToastContext not available, using fallback:", error.message);
    showToast = (message, type = "info") => {
      console.log(`[${type.toUpperCase()}] ${message}`);
      Alert.alert("Notification", message);
    };
  }

  useEffect(() => {
    loadUserData();
    getCurrentLocation();

    const delayedTasks = setTimeout(() => {
      checkActiveTrackingSession();
    }, 800);

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      clearTimeout(delayedTasks);
      subscription.remove();
    };
  }, []);


  useEffect(() => {
    if (!currentLocation || !end) return;

    const routeKey = `${currentLocation.lat.toFixed(5)},${currentLocation.lng.toFixed(5)}_${end.lat.toFixed(5)},${end.lng.toFixed(5)}_${mode}`;

    if (lastRouteRef.current === routeKey) return;

    lastRouteRef.current = routeKey;

    const timer = setTimeout(() => {
      fetchSafeRoute();
    }, 500);

    return () => clearTimeout(timer);
  }, [currentLocation, end, mode, fetchSafeRoute]);



  useEffect(() => {
    if (!userId) {
      const checkUserId = async () => {
        try {
          const storedUser = await AsyncStorage.getItem("userData");
          if (storedUser) {
            const userData = JSON.parse(storedUser);
            console.log("🔄 Re-checking user data:", userData);

            const possibleUserId = userData.id || userData.user_id || userData.userId || userData.uid || userData.ID;
            if (possibleUserId) {
              console.log("✅ Found user ID on re-check:", possibleUserId);
              setUserId(possibleUserId);
            }
          }
        } catch (error) {
          console.error("Re-check error:", error);
        }
      };
      checkUserId();
    }
  }, [userId]);

  useEffect(() => {
    if (!isSharingLiveLocation) return;

    const interval = setInterval(async () => {
      const stored = await AsyncStorage.getItem("active_tracking_session");
      if (!stored) return;

      const session = JSON.parse(stored);

      if (!session.expires_at) return;

      const now = Date.now();
      const expiresAt = new Date(session.expires_at).getTime();

      if (now >= expiresAt) {
        console.log("Session expired — stopping");
        stopLiveLocationSharing();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isSharingLiveLocation]);


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


  const getAddressFromCoords = async (lat, lng) => {
    try {
      console.log("🔍 Reverse geocoding coordinates:", lat, lng);
      const res = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lng,
      });

      console.log("📍 Reverse geocode result:", JSON.stringify(res, null, 2));

      if (res.length > 0) {
        const address = res[0];

        if (address.formattedAddress) {
          return address.formattedAddress;
        }

        const addressParts = [];

        if (address.name) addressParts.push(address.name);
        if (address.street) addressParts.push(address.street);
        if (address.city) addressParts.push(address.city);
        if (address.region) addressParts.push(address.region);
        if (address.postalCode) addressParts.push(address.postalCode);
        if (address.country) addressParts.push(address.country);

        const fullAddress = addressParts.join(", ");

        if (fullAddress.trim().length > 5) {
          console.log("✅ Built address:", fullAddress);
          return fullAddress;
        }
      }

      console.log("⚠️ No detailed address found, using coordinates");
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

    } catch (err) {
      console.error("❌ Reverse geocode error:", err);
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
  };

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showToast("Location permission is required to continue", "error");
        return null;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: isSharingLiveLocation
          ? Location.Accuracy.High
          : Location.Accuracy.Balanced,
      });


      const addressText = await getAddressFromCoords(
        location.coords.latitude,
        location.coords.longitude
      );

      setAddress(addressText);

      const loc = {
        lat: location.coords.latitude,
        lng: location.coords.longitude
      };

      setCurrentLocation(loc);
      return loc;

    } catch (error) {
      console.error("Location error:", error);
      return null;
    }
  };

  const checkActiveTrackingSession = async () => {
    try {
      const stored = await AsyncStorage.getItem("active_tracking_session");
      if (!stored) return;

      const session = JSON.parse(stored);
      const now = Date.now();
      const expiresAt = new Date(session.expires_at).getTime();

      if (now >= expiresAt) {
        console.log(" Session expired — stopping");
        await stopLiveLocationSharing(true);
        return;
      }

      setLiveLocationSessionId(session.session_id);
      setTrackingUrl(session.tracking_url);
      setIsSharingLiveLocation(true);

      setSessionStartTime(
        new Date(session.started_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      );

      await startLocationUpdates();
    } catch (err) {
      console.error("Session restore failed:", err);
    }
  };


  const formatDuration = (minutes) => {
    if (!minutes || minutes <= 0) return "0 min";

    if (minutes < 60) {
      return `${Math.round(minutes)} min`;
    }

    const hrs = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);

    if (mins === 0) {
      return `${hrs} hr`;
    } else if (hrs === 0) {
      return `${mins} min`;
    } else {
      return `${hrs} hr ${mins} min`;
    }
  };

  const formatRouteDistance = (km) => {
    if (!km || km <= 0) return "0 km";
    return `${km.toFixed(2)} km`;
  };

  const formatRouteDuration = (minutes) => {
    return formatDuration(minutes);
  };

  const loadUserData = async () => {
    try {
      const storedUser = await AsyncStorage.getItem("user");
      console.log("Stored user data raw:", storedUser);

      if (storedUser) {
        const userData = JSON.parse(storedUser);
        console.log("Parsed user data:", userData);

        const userId = userData.id;
        setUserId(userId);

        if (!userId) {
          console.error("❌ No user ID found in stored data!");
        } else {
          console.log("✅ User ID loaded:", userId);
        }

        const fullName = userData.fullname || userData.name || userData.full_name || userData.username;
        setUserFullName(fullName || "User");

        const username = userData.email_id ? userData.email_id.split('@')[0] : "User";
        setUserName(fullName || username);
      } else {
        console.error("❌ No user data found in AsyncStorage");
      }
    } catch (error) {
      console.error("❌ Error loading user data:", error);
    }
  };

  const chartData = useMemo(() => {
    const labels = getLast6Months();
    console.log("Chart labels:", labels);

    return {
      labels: labels,
      datasets: [
        {
          data: generateSafetyTrend(safetyScore),
          color: () => getSafetyColor(safetyScore),
          strokeWidth: 3,
          withDots: true,
        },
        {
          data: [100],
          withDots: false,
          strokeWidth: 0,
          color: () => 'transparent',
        },
      ],
    };
  }, [safetyScore]);

  useEffect(() => {
    console.log("Current chart labels:", getLast6Months());
  }, []);


  const locationWatcher = useRef(null);

  const startLocationUpdates = async () => {
    try {
      if (locationWatcher.current) {
        await locationWatcher.current.remove();
        locationWatcher.current = null;
      }

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 10000,
          distanceInterval: 10,
        },
        async (location) => {
          if (!liveLocationSessionId) return;

          await updateLocationOnServer(
            location.coords.latitude,
            location.coords.longitude
          );

          setCurrentLocation({
            lat: location.coords.latitude,
            lng: location.coords.longitude,
          });
        }
      );

      locationWatcher.current = subscription;
    } catch (error) {
      console.error("Location tracking error:", error);
    }
  };

  const updateLocationOnServer = async (latitude, longitude) => {
    try {
      const response = await fetch(`${BASE_URL}/update_location/${liveLocationSessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude,
          longitude,
          timestamp: new Date().toISOString(),
          accuracy: 10,
          speed: 0,
          heading: 0,
        }),
      });

      return response.ok;
    } catch (error) {
      console.error("Error updating location on server:", error);
      return false;
    }
  };


  const formatSharingDuration = (minutes) => {
    if (minutes === 0) return "until manually stopped";

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hours > 0 && mins > 0) return `${hours}h ${mins}min`;
    if (hours > 0) return `${hours}h`;
    return `${mins}min`;
  };

  const calculateETA = (distanceKm, mode, incidentCount = 0) => {
    if (!distanceKm || !SPEEDS[mode]) return 0;

    const baseMinutes = (distanceKm / SPEEDS[mode]) * 60;
    const riskPenalty = Math.min(incidentCount * 0.05, 0.4);

    return Math.round(baseMinutes * (1 + riskPenalty));
  };

  const fetchSafeRoute = useCallback(async () => {
    if (!currentLocation || !end) return;

    const cacheKey = `${currentLocation.lat.toFixed(4)}_${currentLocation.lng.toFixed(4)}_${end.lat.toFixed(4)}_${end.lng.toFixed(4)}_${mode}`;

    const cached = routeCache[cacheKey];
    if (cached && (Date.now() - cached.timestamp < 2 * 60 * 1000)) {
      console.log("📦 Using cached route");
      setRouteInfo(cached.routeInfo);
      setSafetyScore(cached.safetyScore);
      setIncidentCount(cached.incidentCount);
      setRouteLoading(false);
      return;
    }

    try {
      setRouteLoading(true);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(`${BASE_URL}/safe_route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: {
            lat: currentLocation.lat,
            lng: currentLocation.lng,
          },
          end: {
            lat: end.lat,
            lng: end.lng,
          },
          mode: mode,
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      if (!data.success || !data.route) {

        const fallbackData = {
          distance_km: 0,
          duration_min: 0,
          safety_score: 100,
          incident_count: 0,
        };
        setRouteInfo(fallbackData);
        setSafetyScore(100);
        setIncidentCount(0);
        return;
      }


      const calculatedDuration = calculateETA(
        data.route.distance_km,
        mode,
        data.route.incident_count
      );

      const newRouteInfo = {
        distance_km: data.route.distance_km,
        duration_min: calculatedDuration,
        safety_score: data.route.safety_score,
        incident_count: data.route.incident_count,
      };


      let validatedSafetyScore = data.route.safety_score;

      setRouteInfo(newRouteInfo);
      setSafetyScore(validatedSafetyScore);
      setIncidentCount(data.route.incident_count);

      setRouteCache(prev => ({
        ...prev,
        [cacheKey]: {
          routeInfo: newRouteInfo,
          safetyScore: validatedSafetyScore,
          incidentCount: data.route.incident_count,
          timestamp: Date.now()
        }
      }));

    } catch (err) {
      console.error("Safe route error:", err);

      if (err.name === 'AbortError') {
        showToast("Route calculation timed out. Try a shorter route.", "error");
      } else {
        showToast("Could not calculate route", "error");
      }

      const fallbackData = {
        distance_km: 0,
        duration_min: 0,
        safety_score: 100,
        incident_count: 0,
      };
      setRouteInfo(fallbackData);
      setSafetyScore(100);
      setIncidentCount(0);
    } finally {
      setRouteLoading(false);
    }
  }, [currentLocation, end, mode]);

  // Safety helper functions
  const getSafetyColor = (score) => {
    if (score >= 80) return "#4CAF50";
    if (score >= 60) return "#FF9800";
    if (score >= 40) return "#FFC107";
    if (score >= 20) return "#F44336";
    return "#D32F2F";
  };
  const getSafetyLevel = (score) => {
    if (score >= 80) return "Very Safe";
    if (score >= 60) return "Moderately Safe";
    if (score >= 40) return "Some Risks";
    if (score >= 20) return "High Risk";
    return "Extreme Risk";
  };

  const getSafetyDescription = (score, incidentCount) => {
    if (incidentCount === 0) return "No reported incidents along this route";

    if (score >= 80) return `${incidentCount} Incident(s) - Low overall risk`;
    if (score >= 60) return `${incidentCount} Incident(s) - Moderate caution advised`;
    if (score >= 40) return `${incidentCount} Incident(s) - Elevated risk area`;
    if (score >= 20) return `${incidentCount} Incident(s) - High risk, consider alternatives`;
    return `${incidentCount} Incident(s) - Avoid this route if possible`;
  };


  const generateLocalMessage = (type, shareData) => {
    const displayName = userFullName || userName || "User";

    if (type === "live_location") {
      return `📍 HerShield Live Location\n\n${displayName} is sharing their live location with you\n\n🔗 Tracking Link:\n${shareData.tracking_url}\n\n📍 Current Location:\n${shareData.address}\n\n⏱️ Duration: ${shareData.duration_text}\n\nShared via HerShield Safety App`;
    } else {
      const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const riskInfo = shareData.incident_count > 0
        ? `⚠️ ${shareData.incident_count} risk zone${shareData.incident_count > 1 ? 's' : ''} detected`
        : "✅ No risk zones detected";

      const messageParts = [
        `🚶‍♀️ HerShield Safe Route - ${displayName}`,
        "",
        `📍 Current Location (${currentTime}):`,
        shareData.address,
        "",
        "🎯 Destination:",
        shareData.location_name,
        "",
        `📏 Distance: ${shareData.distance}`,
        `⏱️ Estimated Time: ${shareData.duration}`,
        `🛡️ Safety Score: ${shareData.safety_score}/100`,
        "",
        riskInfo,
        "",
        "Shared via HerShield App"
      ];

      return messageParts.join("\n");
    }
  };

  const generateShareMessage = async (type, shareData) => {
    try {
      console.log(" Generating share message via backend...");

      const response = await fetch(`${BASE_URL}/generate_share_message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: type,
          user_id: userId,
          ...shareData
        }),
      });

      const data = await response.json();

      if (data.success) {
        console.log("✅ Message generated successfully");
        return data.message;
      } else {
        console.log("⚠️ Falling back to local message generation");
        return generateLocalMessage(type, shareData);
      }
    } catch (error) {
      console.error("Error generating message:", error);
      return generateLocalMessage(type, shareData);
    }
  };

  const shareToWhatsApp = async (type, shareData) => {
    try {
      console.log(" Starting WhatsApp share for type:", type);

      const message = await generateShareMessage(type, shareData);

      const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;

      const canOpen = await Linking.canOpenURL(whatsappUrl);

      if (canOpen) {
        await Linking.openURL(whatsappUrl);
      } else {
        await Share.share({
          title: type === "live_location" ? "Live Location" : "Safe Route",
          message: message,
          url: type === "live_location" ? shareData.tracking_url : undefined
        });
      }
    } catch (error) {
      console.error("Share error:", error);
      showToast("Sharing failed. Please try copying manually", "error");
    }
  };

  const shareToAnyApp = async (type, shareData) => {
    try {
      console.log(" Starting general share for type:", type);

      const message = await generateShareMessage(type, shareData);

      await Share.share({
        title: type === "live_location" ? "Live Location" : "Safe Route",
        message: message,
        url: type === "live_location" ? shareData.tracking_url : undefined
      });
    } catch (error) {
      console.error("Share error:", error);
      showToast("Sharing failed. Please try copying manually", "error");
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
        const loc = await getCurrentLocation();
        if (!loc) return;
      }

      const isUnlimited = durationMinutes === 0;
      const expiresAt = isUnlimited
        ? null
        : new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

      const sessionData = await createTrackingSession(durationMinutes);
      if (!sessionData) {
        showToast("Failed to start live location", "error");
        return;
      }

      const sessionPayload = {
        session_id: sessionData.session_id,
        tracking_url: sessionData.tracking_url,
        started_at: new Date().toISOString(),
        expires_at: expiresAt,
      };

      await AsyncStorage.setItem(
        "active_tracking_session",
        JSON.stringify(sessionPayload)
      );

      setLiveLocationSessionId(sessionData.session_id);
      setTrackingUrl(sessionData.tracking_url);
      setIsSharingLiveLocation(true);
      setSessionStartTime(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));

      await startLocationUpdates();

      showSharingOptions(sessionData.tracking_url, durationMinutes);

      showToast(
        isUnlimited
          ? "Live location started"
          : `Live location started for ${durationMinutes} minutes`,
        "success"
      );
    } catch (error) {
      console.error("Start live location error:", error);
      showToast("Unable to start live location", "error");
    }
  };

  const createTrackingSession = async (durationMinutes) => {
    try {
      const userNameToUse = userFullName || userName || "User";

      const response = await fetch(`${BASE_URL}/create_tracking_session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId || 0,
          user_name: userNameToUse,
          latitude: currentLocation.lat,
          longitude: currentLocation.lng,
          duration_minutes: durationMinutes,
        }),
      });

      if (!response.ok) {
        console.error("Failed to create tracking session");
        return null;
      }

      const data = await response.json();

      if (data.success) {
        console.log("✅ Tracking session created:", data.session_id);
        return data;
      }

      return null;
    } catch (error) {
      console.error("Create session error:", error);
      return null;
    }
  };

  const stopLiveLocationSharing = async (silent = false) => {
    try {
      if (locationWatcher.current) {
        await locationWatcher.current.remove();
        locationWatcher.current = null;
      }

      if (liveLocationSessionId) {
        await fetch(`${BASE_URL}/stop_tracking_session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: liveLocationSessionId }),
        });
      }

      await AsyncStorage.removeItem("active_tracking_session");

    } catch (e) {
      console.error("Stop error:", e);
    } finally {
      setIsSharingLiveLocation(false);
      setLiveLocationSessionId(null);
      setSessionStartTime(null);
      setTrackingUrl("");
      setLocationUpdatesCount(0);

      if (!silent) {
        showToast("Live location stopped", "success");
      }
    }
  };

  const showSharingOptions = async (trackingUrl, durationMinutes) => {
    const durationText = formatSharingDuration(durationMinutes);

    Alert.alert(
      `Share your Live Location`,
      "Share this tracking link with trusted contacts:",
      [
        {
          text: "Share via WhatsApp",
          onPress: () => shareToWhatsApp("live_location", {
            tracking_url: trackingUrl,
            duration_text: durationText,
            address: address
          })
        },
        {
          text: "Share via Any App",
          onPress: () => shareToAnyApp("live_location", {
            tracking_url: trackingUrl,
            duration_text: durationText,
            address: address
          })
        },
        {
          text: "Copy Link Only",
          onPress: () => {
            Clipboard.setString(trackingUrl);
            showToast("Tracking link copied to clipboard", "success");
          }
        },
        {
          text: "Cancel",
          style: "cancel"
        }
      ]
    );
  };

  const shareLiveLocationAgain = async () => {
    if (!isSharingLiveLocation) {
      showToast("Live location sharing is not active", "error");
      return;
    }

    try {
      const activeSession = await AsyncStorage.getItem('active_tracking_session');
      if (!activeSession) {
        showToast("No active tracking session found", "error");
        await stopLiveLocationSharing();
        return;
      }

      const sessionData = JSON.parse(activeSession);

      const startedAt = new Date(sessionData.started_at);
      const now = new Date();
      const elapsedMinutes = Math.floor((now - startedAt) / (1000 * 60));

      Alert.alert(
        `Share your Live Location Again`,
        "Choose how to share:",
        [
          {
            text: "Share via WhatsApp",
            onPress: () => shareToWhatsApp("live_location", {
              tracking_url: sessionData.tracking_url,
              duration_text: formatSharingDuration(elapsedMinutes),
              address: address
            })
          },
          {
            text: "Share via Any App",
            onPress: () => shareToAnyApp("live_location", {
              tracking_url: sessionData.tracking_url,
              duration_text: `${elapsedMinutes} min elapsed`,
              address: address
            })
          },
          {
            text: "Copy Link",
            onPress: () => {
              Clipboard.setString(sessionData.tracking_url);
              showToast("Tracking link copied to clipboard", "success");
            }
          },
          {
            text: "Cancel",
            style: "cancel"
          }
        ]
      );

    } catch (error) {
      console.error("Error sharing link again:", error);
      showToast("Unable to share link again", "error");
    }
  };

  const shareRoute = async () => {
    if (!routeInfo) {
      showToast("No route information available", "error");
      return;
    }

    Alert.alert(
      `Share your Route`,
      "Share this safe route information:",
      [
        {
          text: "Share via WhatsApp",
          onPress: () => shareToWhatsApp("safe_route", {
            location_name: locationName || "Destination",
            distance: formatRouteDistance(routeInfo?.distance_km),
            duration: formatRouteDuration(routeInfo?.duration_min),
            safety_score: safetyScore,
            incident_count: incidentCount,
            address: address
          })
        },
        {
          text: "Share via Any App",
          onPress: () => shareToAnyApp("safe_route", {
            location_name: locationName || "Destination",
            distance: formatRouteDistance(routeInfo?.distance_km),
            duration: formatRouteDuration(routeInfo?.duration_min),
            safety_score: safetyScore,
            incident_count: incidentCount,
            address: address
          })
        },
        {
          text: "Cancel",
          style: "cancel"
        }
      ]
    );
  };

  const startNavigation = async () => {
    try {
      const response = await fetch(`${BASE_URL}/safe_route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, end }),
      });

      const data = await response.json();

      if (!data.success || !data.route) {
        showToast("No route data found", "error");
        return;
      }

      navigation.navigate("Navigation", {
        start,
        end,
        locationName,
        routes: Array.isArray(data.route) ? data.route : [data.route],
      });

    } catch (error) {
      console.error("Navigation error:", error);
      showToast("Unable to start navigation", "error");
    }
  };


  const durationOptions = [
    { label: `15 minutes`, value: 15 },
    { label: `30 minutes`, value: 30 },
    { label: `1 hour`, value: 60 },
    { label: `2 hours`, value: 120 },
    { label: "Until I stop", value: 0 },
  ];

  if (loading || routeLoading || !routeInfo) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#570a1c" />
        <Text style={styles.loadingText}>Calculating safest route...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader
        title="Route Details"
        showBack={true}
        onBack={onClose}
        variant="dark"
        showProfile={false}
      />

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Address Card*/}
        <View style={styles.addressCard}>
          <View style={styles.addressHeader}>
            <View style={[styles.iconCircle, { backgroundColor: '#E3F2FD' }]}>
              <Ionicons name="location" size={20} color="#570a1c" />
            </View>
            <View style={styles.addressContent}>
              <Text style={styles.addressLabel}>Current Location</Text>
              <Text style={styles.addressText} numberOfLines={2}>
                {address || "Getting location..."}
              </Text>
              {currentLocation && (
                <Text style={styles.coordinatesText}>
                  {currentLocation.lat.toFixed(6)}, {currentLocation.lng.toFixed(6)}
                </Text>
              )}
            </View>
          </View>
          <TouchableOpacity style={styles.refreshBtn} onPress={getCurrentLocation}>
            <Ionicons name="refresh" size={16} color="#570a1c" />
          </TouchableOpacity>
        </View>

        {/* Destination Card */}
        <View style={styles.destinationCard}>
          <View style={styles.destinationHeader}>
            <View style={[styles.iconCircle, { backgroundColor: '#FFF3E0' }]}>
              <Ionicons name="navigate" size={20} color="#FF9800" />
            </View>
            <View style={styles.destinationContent}>
              <Text style={styles.addressLabel}>Destination</Text>
              <Text style={styles.addressText}>{locationName || "Destination"}</Text>
              {end && (
                <Text style={styles.coordinatesText}>
                  {end.lat.toFixed(6)}, {end.lng.toFixed(6)}
                </Text>
              )}
            </View>
          </View>

          <View style={styles.travelModeContainer}>
            <TouchableOpacity
              style={[
                styles.travelModeButton,
                mode === "walk" && styles.travelModeActive
              ]}
              onPress={() => setMode("walk")}
            >
              <Ionicons
                name="walk"
                size={22}
                color={mode === "walk" ? '#570a1c' : '#666'}
              />
              <Text style={[
                styles.travelModeText,
                mode === "walk" && styles.travelModeTextActive
              ]}>
                Walk
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.travelModeButton,
                mode === "vehicle" && styles.travelModeActive
              ]}
              onPress={() => setMode("vehicle")}
            >
              <Ionicons
                name="car"
                size={22}
                color={mode === "vehicle" ? '#570a1c' : '#666'}
              />
              <Text style={[
                styles.travelModeText,
                mode === "vehicle" && styles.travelModeTextActive
              ]}>
                Vehicle
              </Text>
            </TouchableOpacity>
          </View>

          {/* Route Stats */}
          <View style={styles.statsContainer}>
            <View style={styles.statBox}>
              <Ionicons name="navigate" size={20} color="#570a1c" />
              <Text style={styles.statValue}>
                {formatRouteDistance(routeInfo?.distance_km || 0)}
              </Text>
              <Text style={styles.statLabel}>Distance</Text>
            </View>

            <View style={styles.statBox}>
              <Ionicons name="time" size={20} color="#570a1c" />
              <Text style={styles.statValue}>
                {formatRouteDuration(routeInfo?.duration_min)}
              </Text>
              <Text style={styles.statLabel}>Time</Text>
            </View>

            <View style={styles.statBox}>
              <Ionicons name="warning" size={20} color="#570a1c" />
              <Text style={styles.statValue}>{incidentCount}</Text>
              <Text style={styles.statLabel}>Risks</Text>
            </View>
          </View>
        </View>

        <View style={styles.safetyCard}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Safety Score</Text>
            <TouchableOpacity onPress={() => showToast("Based on historical incidents with time-based weighting", "info")}>
              <Ionicons name="information-circle-outline" size={20} color="#666" />
            </TouchableOpacity>
          </View>

          <View style={styles.safetyContent}>
            <View style={[styles.scoreCircle, { borderColor: getSafetyColor(safetyScore) }]}>
              <Text style={[styles.scoreNumber, { color: getSafetyColor(safetyScore) }]}>
                {Math.round(safetyScore)}
              </Text>
              <Text style={styles.scoreLabel}>/100</Text>
            </View>

            <View style={styles.safetyInfo}>
              <Text style={[styles.safetyLevel, { color: getSafetyColor(safetyScore) }]}>
                {getSafetyLevel(safetyScore)}
              </Text>
              <Text style={styles.safetyDescription}>
                {getSafetyDescription(safetyScore, incidentCount)}
              </Text>
            </View>
          </View>

          <View style={styles.chartContainer}>
            {routeInfo && (<LineChart
              data={chartData}
              width={width - 60}
              height={180}
              fromZero={true}
              segments={5}
              withHorizontalLabels={true}
              withVerticalLabels={true}
              verticalLabelRotation={-15}

              chartConfig={{
                backgroundColor: "#fff",
                backgroundGradientFrom: "#fff",
                backgroundGradientTo: "#fff",
                decimalPlaces: 0,
                color: () => getSafetyColor(safetyScore),
                style: { borderRadius: 16 },
                propsForDots: {
                  r: "6",
                  strokeWidth: "2",
                  stroke: "#fff"
                },
                propsForLabels: {
                  fontSize: 10,
                  fontWeight: '500',
                }
              }}

              formatXLabel={(value) => {
                if (value && value.includes(' ')) {
                  return value;
                }
                try {
                  const date = new Date(value);
                  if (!isNaN(date)) {
                    return date.toLocaleString("en-US", { month: "short", year: "numeric" });
                  }
                } catch (e) {
                  return value;
                }
                return value;
              }}

              style={styles.chart}
            />)}
          </View>

          <View style={styles.legend}>
            {[
              { label: "Very Safe", range: "(80-100)", color: "#4CAF50" },
              { label: "Moderate", range: "(60-79)", color: "#FF9800" },
              { label: "Risky", range: "(40-59)", color: "#FFC107" },
              { label: "High Risk", range: "(20-39)", color: "#F44336" },
              { label: "Avoid", range: "(0-19)", color: "#D32F2F" },
            ].map((item) => (
              <View key={item.range} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                <Text style={styles.legendText}>
                  <Text style={styles.legendLabel}>{item.label}</Text><Text style={styles.legendRange}> {item.range}</Text>
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.optionsCard}>
          <Text style={styles.cardTitle}>Options</Text>

          <TouchableOpacity style={styles.optionItem} onPress={startNavigation}>
            <View style={[styles.optionIcon, { backgroundColor: "#E8F5E9" }]}>
              <Ionicons name="navigate" size={24} color="#4CAF50" />
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
              <Text style={styles.optionSubtitle}>Share your real-time location with contacts</Text>
              {isSharingLiveLocation && (
                <View style={styles.activeIndicator}>
                  <Ionicons name="radio-button-on" size={10} color="#4CAF50" />
                  <Text style={styles.activeText}>Active</Text>
                </View>
              )}
            </View>
            <Ionicons name="chevron-forward" size={20} color="#ccc" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.optionItem} onPress={shareRoute}>
            <View style={[styles.optionIcon, { backgroundColor: "#E3F2FD" }]}>
              <Ionicons name="share-social" size={24} color="#2196F3" />
            </View>
            <View style={styles.optionContent}>
              <Text style={styles.optionTitle}>Share Route Details</Text>
              <Text style={styles.optionSubtitle}>Share this safe route information</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#ccc" />
          </TouchableOpacity>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="information-circle" size={20} color='rgba(139, 19, 62, 0.9)' />
          <View style={styles.infoContent}>
            <Text style={styles.infoTitle}>Live Location Features</Text>
            <Text style={styles.infoText}>
              • Share real-time location with trusted contacts{"\n"}
              • Choose duration: 15 min to 2 hours or manual stop{"\n"}
              • Interactive map with live updates{"\n"}
              • Recipients can view on any device{"\n"}
              • Stop sharing anytime from this screen
            </Text>
          </View>
        </View>
      </ScrollView>


      <Modal
        animationType="slide"
        transparent={true}
        visible={liveLocationModalVisible}
        onRequestClose={() => setLiveLocationModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView
              contentContainerStyle={{ paddingBottom: 30 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {isSharingLiveLocation ? `Sharing Your Live Location` : "Share Live Location"}
                </Text>
                <View style={styles.headerRight}>
                  <TouchableOpacity
                    onPress={() => setLiveLocationModalVisible(false)}
                    style={styles.modalCloseButton}
                  >
                    <Ionicons name="close" size={24} color="#666" />
                  </TouchableOpacity>
                </View>
              </View>

              {isSharingLiveLocation ? (
                <View style={styles.activeSessionView}>
                  <Ionicons name="radio-button-on" size={40} color="#5cb85c" />
                  <Text style={styles.activeSessionTitle}> Active</Text>

                  <View style={styles.sessionStatsContainer}>
                    <View style={styles.sessionStat}>
                      <Ionicons name="time-outline" size={20} color="#666" />
                      <Text style={styles.sessionStatText}>
                        Started: {sessionStartTime || "Just now"}
                      </Text>
                    </View>

                    <View style={styles.sessionStat}>
                      <Ionicons name="refresh-outline" size={20} color="#666" />
                      <Text style={styles.sessionStatText}>
                        Updates: {locationUpdatesCount}
                      </Text>
                    </View>

                    {trackingUrl ? (
                      <View style={styles.sessionStat}>
                        <Ionicons name="link-outline" size={20} color="#666" />
                        <TouchableOpacity onPress={() => {
                          Clipboard.setString(trackingUrl);
                          showToast("Tracking link copied to clipboard", "success");
                        }}>
                          <Text style={[styles.sessionStatText, styles.copyLinkText]} numberOfLines={1}>
                            Tap to copy link
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>

                  <TouchableOpacity
                    style={styles.shareAgainButton}
                    onPress={shareLiveLocationAgain}
                  >
                    <Ionicons name="share-outline" size={20} color="#fff" />
                    <Text style={styles.shareAgainText}>Share Link Again</Text>
                  </TouchableOpacity>

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
                          showToast("Please enter a valid number of minutes", "error");
                        }
                      }}
                      disabled={!customDuration}
                    >
                      <Text style={styles.customDurationButtonText}>Set</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.infoCard}>
                    <Ionicons name="information-circle" size={20} color='rgba(139, 19, 62, 0.9)' />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoText}>
                        Location updates every 10 seconds. Recipients get a clickable link that opens in any browser.
                      </Text></View>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
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
  addressCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: "#fff",
    margin: 16,
    borderRadius: 16,
    padding: 16,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  addressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  addressContent: {
    flex: 1,
  },
  addressLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  addressText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
    lineHeight: 22,
  },
  coordinatesText: {
    fontSize: 11,
    color: "#999",
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  refreshBtn: {
    padding: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginLeft: 8,
  },
  destinationCard: {
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    padding: 20,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  destinationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  destinationContent: {
    flex: 1,
    marginLeft: 12,
  },
  destinationLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "#666",
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  destinationTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#333",
    marginBottom: 4,
  },
  travelModeContainer: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  travelModeButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  travelModeActive: {
    backgroundColor: '#fff',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  travelModeText: {
    fontSize: 14,
    fontWeight: '500',
    color: "#666",
    marginLeft: 6,
  },
  travelModeTextActive: {
    color: "#570a1c",
    fontWeight: '600',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  statBox: {
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#570a1c",
    marginTop: 8,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    color: "#666",
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  safetyCard: {
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    padding: 20,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#333",
  },
  safetyContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  scoreCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    marginRight: 20,
    backgroundColor: '#f8f9fa',
  },
  scoreNumber: {
    fontSize: 28,
    fontWeight: "800",
  },
  scoreLabel: {
    fontSize: 14,
    color: "#999",
    fontWeight: '500',
  },
  safetyInfo: {
    flex: 1,
  },
  safetyLevel: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  safetyDescription: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
    marginBottom: 12,
  },
  chartContainer: {
    marginTop: 10,
    overflow: 'visible',
  },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
  },
  optionsCard: {
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    padding: 20,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
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
  activeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  activeText: {
    fontSize: 10,
    color: "#4CAF50",
    fontWeight: '600',
    marginLeft: 4,
  },
  infoCard: {
    flexDirection: "row",
    backgroundColor: "#fdf4f7",
    marginHorizontal: 16,
    marginBottom: 20,
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
    color: 'rgba(139, 19, 62, 0.9)',
    marginBottom: 5,
  },
  infoText: {
    fontSize: 12,
    color: 'rgba(139, 19, 62, 0.9)',
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 16,
    maxHeight: '85%',
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
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#570a1c',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginTop: 8,
    alignSelf: 'flex-start',
    gap: 4,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
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
  sessionStatsContainer: {
    width: '100%',
    marginVertical: 20,
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
  },
  sessionStat: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  sessionStatText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 10,
  },
  copyLinkText: {
    color: '#570a1c',
    textDecorationLine: 'underline',
  },
  shareAgainButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9B1553',
    paddingVertical: 15,
    borderRadius: 10,
    marginBottom: 10,
    width: '100%',
  },
  shareAgainText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 10,
  },
  stopSharingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F44336',
    paddingVertical: 15,
    borderRadius: 10,
    marginTop: 10,
    width: '100%',
  },
  stopSharingText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 10,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '48%',
    marginBottom: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  legendText: {
    fontSize: 11,
    color: "#666",
  },
  legendRange: {
    fontWeight: '600',
  },
});