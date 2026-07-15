import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Share,
  Linking,
  TextInput,
  Alert,
  ScrollView,
} from "react-native";

import * as Location from "expo-location";
import { getDistance } from "geolib";
import { Ionicons } from "@expo/vector-icons";

import WebMapComponent from "../components/WebMapComponent";
import MapFloatingControls from "../components/MapFloatingControls";
import { BASE_URL } from "../utils/config";
import Clipboard from '@react-native-clipboard/clipboard';
import AppHeader from "../components/AppHeader";
import { useToast } from "../context/ToastContext";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SpeechModule = (() => {
  try {
    return require("expo-speech");
  } catch {
    return null;
  }
})();


export default function NavigationScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { selectedRoute, end } = route.params;
  const [remainingTime, setRemainingTime] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef(null);
  const watcher = useRef(null);
  const toast = useToast();
  const offRouteCounterRef = useRef(0);
  const lastCameraUpdateRef = useRef(0);
  const [liveLocation, setLiveLocation] = useState(null);
  const [routeDrawn, setRouteDrawn] = useState(false);
  const [incidentCount, setIncidentCount] = useState(0);
  const [nearbyReportItems, setNearbyReportItems] = useState([]);
  const [showReportsPanel, setShowReportsPanel] = useState(true);
  const lastIncidentFetchRef = useRef(0);
  const [followUser, setFollowUser] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const navigationStartTimeoutRef = useRef(null);
  const normalizedRouteRef = useRef([]);
  const currentStepIndexRef = useRef(0);
  const lastRerouteAtRef = useRef(0);
  const lastVoiceStepRef = useRef(-1);
  const arrivalAnnouncedRef = useRef(false);

  const [shareVisible, setShareVisible] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState(15);
  const [trackingUrl, setTrackingUrl] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const [customTime, setCustomTime] = useState("");
  const [userName, setUserName] = useState("User");
  const [navigationSteps, setNavigationSteps] = useState([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [currentStepDistance, setCurrentStepDistance] = useState(null);
  const [distanceToDestination, setDistanceToDestination] = useState(null);
  const [isRerouting, setIsRerouting] = useState(false);
  const [lastOffRouteDistance, setLastOffRouteDistance] = useState(null);

  const OFF_ROUTE_THRESHOLD_METERS = 35;
  const REROUTE_COOLDOWN_MS = 8000;
  const STEP_REACHED_DISTANCE_METERS = 30;
  const DESTINATION_REACHED_METERS = 20;

  const getLngLatFromPoint = (point) => {
    if (!point) return null;

    if (Array.isArray(point) && point.length >= 2) {
      const first = Number(point[0]);
      const second = Number(point[1]);
      if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

      // Support both [lat, lng] and [lng, lat]
      if (Math.abs(first) <= 90 && Math.abs(second) <= 180) {
        return [second, first];
      }
      if (Math.abs(first) <= 180 && Math.abs(second) <= 90) {
        return [first, second];
      }
      return null;
    }

    if (typeof point === "object") {
      const lat = Number(point.lat ?? point.latitude);
      const lng = Number(point.lng ?? point.lon ?? point.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      return [lng, lat];
    }

    return null;
  };

  const toXY = (lng, lat, refLat) => {
    const scale = Math.cos((refLat * Math.PI) / 180);
    return { x: lng * scale, y: lat };
  };

  const toLngLat = (x, y, refLat) => {
    const scale = Math.cos((refLat * Math.PI) / 180) || 1;
    return [x / scale, y];
  };

  const approxDistanceMeters = (a, b) => {
    const dLat = (b[1] - a[1]) * 111320;
    const avgLatRad = (((a[1] + b[1]) / 2) * Math.PI) / 180;
    const dLng = (b[0] - a[0]) * 111320 * Math.cos(avgLatRad);
    return Math.sqrt(dLat * dLat + dLng * dLng);
  };

  const bearingDegrees = (from, to) => {
    if (!from || !to) return 0;
    const [lng1, lat1] = from;
    const [lng2, lat2] = to;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const lambda = ((lng2 - lng1) * Math.PI) / 180;
    const y = Math.sin(lambda) * Math.cos(phi2);
    const x =
      Math.cos(phi1) * Math.sin(phi2) -
      Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda);
    const theta = (Math.atan2(y, x) * 180) / Math.PI;
    return (theta + 360) % 360;
  };

  const deltaAngleSigned = (next, prev) => {
    let d = next - prev;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  };

  const getTurnInstruction = (turnDelta) => {
    const absDelta = Math.abs(turnDelta);
    if (absDelta < 20) return "Continue straight";
    if (absDelta < 45) return turnDelta > 0 ? "Slight right" : "Slight left";
    if (absDelta < 120) return turnDelta > 0 ? "Turn right" : "Turn left";
    return turnDelta > 0 ? "Make a U-turn" : "Make a U-turn";
  };

  const buildTurnByTurnFromGeometry = (routeCoords = []) => {
    if (!Array.isArray(routeCoords) || routeCoords.length < 3) return [];
    const steps = [];
    for (let i = 1; i < routeCoords.length - 1; i += 1) {
      const prev = routeCoords[i - 1];
      const cur = routeCoords[i];
      const next = routeCoords[i + 1];
      if (!prev || !cur || !next) continue;
      const b1 = bearingDegrees(prev, cur);
      const b2 = bearingDegrees(cur, next);
      const delta = deltaAngleSigned(b2, b1);
      const instruction = getTurnInstruction(delta);
      const shouldAdd =
        instruction !== "Continue straight" || i % 8 === 0;
      if (!shouldAdd) continue;
      steps.push({
        instruction,
        point: cur,
        distanceMeters: Math.round(approxDistanceMeters(prev, cur)),
      });
    }

    steps.push({
      instruction: "You are arriving at your destination",
      point: routeCoords[routeCoords.length - 1],
      distanceMeters: 0,
    });
    return steps;
  };

  const normalizeStep = (step, index) => {
    const instruction =
      step?.instruction ||
      step?.text ||
      step?.description ||
      step?.maneuver?.instruction ||
      step?.name ||
      `Continue to step ${index + 1}`;

    const pointCandidate =
      step?.point ||
      step?.location ||
      step?.end_location ||
      step?.to ||
      step?.position ||
      step?.latlng ||
      step?.coordinates;

    const lngLat = getLngLatFromPoint(pointCandidate);
    const distanceMeters = Number(
      step?.distance_m ??
      step?.distance ??
      step?.distanceMeters ??
      step?.length_m ??
      0
    );

    return {
      instruction,
      point: lngLat,
      distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : 0,
    };
  };

  const extractSteps = (routeObj, routeCoords = []) => {
    const fromRoute =
      routeObj?.steps ||
      routeObj?.instructions ||
      routeObj?.maneuvers ||
      routeObj?.navigation?.steps ||
      routeObj?.legs?.[0]?.steps ||
      [];

    const normalizedFromRoute = Array.isArray(fromRoute)
      ? fromRoute.map(normalizeStep).filter((s) => !!s.point || !!s.instruction)
      : [];

    if (normalizedFromRoute.length > 0) {
      const mapped = normalizedFromRoute.map((step, idx) => ({
        ...step,
        point: step.point || routeCoords[Math.min(idx + 1, routeCoords.length - 1)] || null,
      }));

      const hasTurnWords = mapped.some((step) =>
        /\b(left|right|u-?turn|arriv|destination|roundabout)\b/i.test(
          step?.instruction || ""
        )
      );
      if (hasTurnWords) return mapped;

      // If backend steps are too generic, synthesize turn-by-turn from geometry.
      const geometrySteps = buildTurnByTurnFromGeometry(routeCoords);
      return geometrySteps.length ? geometrySteps : mapped;
    }

    // Fallback: create synthetic guidance steps from route geometry.
    if (!routeCoords.length) return [];
    const synthetic = buildTurnByTurnFromGeometry(routeCoords);
    return synthetic;
  };

  const speakText = (text) => {
    if (!text) return;
    try {
      if (SpeechModule?.stop) {
        SpeechModule.stop();
      }
      if (SpeechModule?.speak) {
        SpeechModule.speak(text, { rate: 0.95, pitch: 1.0 });
      }
    } catch (e) {
      console.log("Voice speak error", e);
    }
  };

  const getDestinationLngLat = () => getLngLatFromPoint(end);

  const formatInstructionWithDistance = (instruction, distanceMeters) => {
    const base = (instruction || "Follow the highlighted route").trim();
    if (distanceMeters == null || !Number.isFinite(distanceMeters)) return base;
    const meters = Math.max(0, Math.round(distanceMeters));
    if (meters <= 20) return `${base} now`;
    const distanceLabel =
      meters >= 1000
        ? `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`
        : `${meters} m`;
    return `After ${distanceLabel}, ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
  };

  const updateNavigationStepState = (userLngLat, speed = 0) => {
    if (!isNavigating || !navigationSteps.length || !userLngLat) return;

    const destination = getDestinationLngLat();

    // ✅ Destination detection (adaptive)
    if (destination) {
      const distToDest = approxDistanceMeters(userLngLat, destination);
      setDistanceToDestination(Math.round(distToDest));

      if (distToDest <= Math.max(20, speed * 2)) {
        if (!arrivalAnnouncedRef.current) {
          arrivalAnnouncedRef.current = true;
          setIsNavigating(false);
          setFollowUser(false);
          speakText("You have reached your destination. Stay safe!");
          toast.showToast("You have reached your destination. Stay safe!", "success");
        }
        return;
      }
    }

    let idx = currentStepIndexRef.current;

    // ✅ Look-ahead logic (2 steps ahead)
    for (let i = idx; i < Math.min(idx + 2, navigationSteps.length); i++) {
      const step = navigationSteps[i];
      if (!step?.point) continue;

      const d = approxDistanceMeters(userLngLat, step.point);

      const dynamicThreshold = Math.max(
        15,
        Math.min(40, step.distanceMeters * 0.2 || 25)
      );

      if (d <= dynamicThreshold) {
        idx = i + 1;
      } else {
        setCurrentStepDistance(Math.round(d));

        // Speak before turn
        if (d < 60 && lastVoiceStepRef.current !== i) {
          lastVoiceStepRef.current = i;
          speakText(formatInstructionWithDistance(step.instruction, d));
        }
        break;
      }
    }

    const nextIndex = Math.min(idx, navigationSteps.length - 1);

    if (nextIndex !== currentStepIndexRef.current) {
      currentStepIndexRef.current = nextIndex;
      setCurrentStepIndex(nextIndex);

      const stepText = navigationSteps[nextIndex]?.instruction;

      if (stepText && lastVoiceStepRef.current !== nextIndex) {
        lastVoiceStepRef.current = nextIndex;
        speakText(stepText);
      }
    }
  };

  const updateNavCamera = (displayLat, displayLng, routeCoords, heading, speed) => {
    if (!followUser || !isNavigating) return;

    const now = Date.now();
    if (now - lastCameraUpdateRef.current < 400) return;
    lastCameraUpdateRef.current = now;

    const userLngLat = [displayLng, displayLat];
    const nearest = getNearestPointOnRoute(userLngLat, routeCoords);

    let target = userLngLat;

    let nearestIndex = -1;
    if (nearest?.point) {
      nearestIndex = routeCoords.findIndex(
        (p) => approxDistanceMeters(p, nearest.point) < 5
      );
      if (nearestIndex < 0) {
        let bestIdx = 0;
        let bestDist = Number.POSITIVE_INFINITY;
        routeCoords.forEach((p, idx) => {
          const d = approxDistanceMeters(p, nearest.point);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = idx;
          }
        });
        nearestIndex = bestIdx;
      }

      const aheadPoint =
        routeCoords[Math.min(nearestIndex + 8, routeCoords.length - 1)];

      target = aheadPoint || nearest.point;
    }

    // Dynamic zoom
    let zoom = 18;
    if (speed > 10) zoom = 17;
    if (speed > 20) zoom = 16;

    const routeBearing =
      nearestIndex >= 0 && routeCoords[nearestIndex + 1]
        ? bearingDegrees(routeCoords[nearestIndex], routeCoords[nearestIndex + 1])
        : null;
    const cameraBearing = Number.isFinite(heading) ? heading : routeBearing || 0;

    mapRef.current?.animateCamera?.({
      center: [target[0], target[1]],
      zoom,
      bearing: cameraBearing,
      duration: 400,
    });
  };

  const rerouteFromCurrentLocation = async (coords) => {
    const now = Date.now();
    if (isRerouting || now - lastRerouteAtRef.current < REROUTE_COOLDOWN_MS) return;

    try {
      setIsRerouting(true);
      lastRerouteAtRef.current = now;
      speakText("Off route detected. Rerouting.");
      toast.showToast("Off-route detected. Rerouting...", "warning");

      const res = await fetch(`${BASE_URL}/safe_route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: { lat: coords.latitude, lng: coords.longitude },
          end: { lat: end.lat, lng: end.lng },
          mode: "walk",
          multiple: false,
        }),
      });
      const data = await res.json();
      const nextRoute = data?.route || data?.routes?.[0];
      if (!res.ok || !data?.success || !nextRoute) {
        toast.showToast("Reroute failed. Continuing current route.", "error");
        return;
      }

      const convertedCoords = (nextRoute?.coords || [])
        .map(getLngLatFromPoint)
        .filter(Boolean);
      if (convertedCoords.length < 2) {
        toast.showToast("Reroute unavailable.", "error");
        return;
      }

      normalizedRouteRef.current = convertedCoords;
      mapRef.current?.showRoutes([{ coords: convertedCoords, color: "#1E88E5" }]);
      mapRef.current?.highlightRoute(0);
      mapRef.current?.fitRoute(convertedCoords);

      const freshSteps = extractSteps(nextRoute, convertedCoords);
      setNavigationSteps(freshSteps);
      currentStepIndexRef.current = 0;
      setCurrentStepIndex(0);
      setCurrentStepDistance(null);
      lastVoiceStepRef.current = -1;
      if (freshSteps[0]?.instruction) {
        speakText(freshSteps[0].instruction);
      }
    } catch (e) {
      console.log("Reroute error:", e);
    } finally {
      setIsRerouting(false);
    }
  };

  const getNearestPointOnRoute = (userLngLat, routeCoords) => {
    if (!userLngLat || !routeCoords?.length) return null;
    if (routeCoords.length === 1) return routeCoords[0];

    let bestPoint = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < routeCoords.length - 1; i += 1) {
      const a = routeCoords[i];
      const b = routeCoords[i + 1];
      if (!a || !b) continue;

      const refLat = (a[1] + b[1] + userLngLat[1]) / 3;
      const pa = toXY(a[0], a[1], refLat);
      const pb = toXY(b[0], b[1], refLat);
      const pp = toXY(userLngLat[0], userLngLat[1], refLat);

      const abx = pb.x - pa.x;
      const aby = pb.y - pa.y;
      const abLenSq = abx * abx + aby * aby;
      if (abLenSq === 0) continue;

      let t = ((pp.x - pa.x) * abx + (pp.y - pa.y) * aby) / abLenSq;
      t = Math.max(0, Math.min(1, t));

      const projX = pa.x + t * abx;
      const projY = pa.y + t * aby;
      const projLngLat = toLngLat(projX, projY, refLat);
      const dist = approxDistanceMeters(userLngLat, projLngLat);

      if (dist < bestDistance) {
        bestDistance = dist;
        bestPoint = projLngLat;
      }
    }

    return bestPoint ? { point: bestPoint, distance: bestDistance } : null;
  };

  /* ================= FORMAT ================= */
  const formatTime = (min) => {
    if (!min) return "0 min";
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)}h ${min % 60}m`;
  };
  const formatDurationNice = (minutes) => {
    if (!minutes || minutes <= 0) return "0 min";

    const hrs = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);

    if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
    if (hrs > 0) return `${hrs}h`;
    return `${mins} min`;
  };

  useEffect(() => {
    const loadUser = async () => {
      try {
        const data = await AsyncStorage.getItem("user");
        if (data) {
          const parsed = JSON.parse(data);
          setUserName(parsed.fullname || parsed.name || "User");
        }
      } catch (e) {
        console.log("User load error", e);
      }
    };

    loadUser();
  }, []);

  useEffect(() => {
    if (!isSharing) return;

    const interval = setInterval(async () => {
      const stored = await AsyncStorage.getItem("active_tracking_session");
      if (!stored) return;

      const session = JSON.parse(stored);

      if (!session.expires_at) return; // unlimited case

      const now = Date.now();
      const expiry = new Date(session.expires_at).getTime();

      if (now >= expiry) {
        stopSharing();
      }
    }, 5000); // check every 5 sec

    return () => clearInterval(interval);
  }, [isSharing]);

  useEffect(() => {
    if (!isSharing) return;

    const interval = setInterval(async () => {
      const stored = await AsyncStorage.getItem("active_tracking_session");
      if (!stored) return;

      const session = JSON.parse(stored);

      if (!session.expires_at) {
        setRemainingTime("Until you stop");
        return;
      }

      const now = Date.now();
      const expiry = new Date(session.expires_at).getTime();
      const diff = expiry - now;

      if (diff <= 0) {
        setRemainingTime("Ending...");
        return;
      }

      const mins = Math.floor(diff / 60000);
      const hrs = Math.floor(mins / 60);
      const remMin = mins % 60;

      if (hrs > 0) {
        setRemainingTime(`${hrs}h ${remMin}m left`);
      } else {
        setRemainingTime(`${mins} min left`);
      }

    }, 1000);

    return () => clearInterval(interval);
  }, [isSharing]);

  /* ================= DRAW ROUTE (SAFE) ================= */
  const drawRouteOnce = () => {
    if (!selectedRoute?.coords?.length) return;

    try {
      const convertedCoords = selectedRoute.coords
        .map(getLngLatFromPoint)
        .filter(Boolean);
      if (convertedCoords.length < 2) return;

      const routeObj = {
        coords: convertedCoords,
        color: "#4CAF50",
      };
      normalizedRouteRef.current = convertedCoords;

      console.log("✅ FINAL ROUTE:", routeObj.coords);

      mapRef.current?.showRoutes([routeObj]);
      mapRef.current?.highlightRoute(0);

      const endPoint = convertedCoords[convertedCoords.length - 1];
      if (endPoint) {
        mapRef.current?.setEnd(endPoint[1], endPoint[0]);
      }

      mapRef.current?.fitRoute?.(routeObj.coords);

      setRouteDrawn(true);

    } catch (e) {
      console.log("❌ Route draw error:", e);
    }
  };

  const copyLink = async () => {
    Clipboard.setString(getShareMessage());
    toast.showToast("Tracking link copied to clipboard", "success");
  };

  /* ================= INCIDENT ================= */
  const REPORT_RADIUS_M = 8000;

  const fetchIncidents = async (loc) => {
    const now = Date.now();
    if (
      lastIncidentFetchRef.current &&
      now - lastIncidentFetchRef.current < 30000
    ) {
      return;
    }
    lastIncidentFetchRef.current = now;

    try {
      const res = await fetch(`${BASE_URL}/incidents/recent`);
      const data = await res.json();

      if (!data?.success || !Array.isArray(data.incidents)) {
        setIncidentCount(0);
        setNearbyReportItems([]);
        mapRef.current?.clearIncidents();
        return;
      }

      const normalized = data.incidents
        .map((i, idx) => {
          const lat = parseFloat(i.latitude ?? i.lat);
          const lng = parseFloat(i.longitude ?? i.lng);
          return {
            id: i.id ?? `inc-${idx}`,
            latitude: lat,
            longitude: lng,
            severity: i.severity ?? 1,
            incident_type: i.incident_type || "Safety report",
            description: (i.description || "").trim(),
            place_name: (i.place_name || "").trim(),
          };
        })
        .filter(
          (i) =>
            Number.isFinite(i.latitude) &&
            Number.isFinite(i.longitude)
        );

      const from = { latitude: loc.latitude, longitude: loc.longitude };
      const withDistance = normalized
        .map((i) => ({
          ...i,
          distanceM: getDistance(from, {
            latitude: i.latitude,
            longitude: i.longitude,
          }),
        }))
        .filter((i) => i.distanceM <= REPORT_RADIUS_M)
        .sort((a, b) => a.distanceM - b.distanceM);

      const forMap = withDistance.map(({ distanceM, ...rest }) => rest);

      setIncidentCount(forMap.length);
      setNearbyReportItems(withDistance);
      mapRef.current?.clearIncidents();
      if (forMap.length) mapRef.current?.addIncidents(forMap);
    } catch {
      setIncidentCount(0);
      setNearbyReportItems([]);
    }
  };

  useEffect(() => {
    if (mapReady && selectedRoute?.coords?.length && !routeDrawn) {
      drawRouteOnce();
    }
  }, [mapReady]);

  /* ================= LOCATION ================= */
  useEffect(() => {
    startTracking();
    return () => {
      watcher.current?.remove();
      if (navigationStartTimeoutRef.current) {
        clearTimeout(navigationStartTimeoutRef.current);
      }
    };
  }, []);

  const startTracking = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;

    watcher.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 5,
      },
      (loc) => {
        const coords = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };

        setLiveLocation(coords);

        const userLngLat = [coords.longitude, coords.latitude];

        // Always compute distance-to-destination and detect arrival
        const destination = getDestinationLngLat();
        if (destination) {
          const distToDest = approxDistanceMeters(userLngLat, destination);
          setDistanceToDestination(Math.round(distToDest));

          if (isNavigating && distToDest <= DESTINATION_REACHED_METERS) {
            if (!arrivalAnnouncedRef.current) {
              arrivalAnnouncedRef.current = true;
              setIsNavigating(false);
              setFollowUser(false);
              speakText("You have reached your destination. Stay safe!");
              toast.showToast("You have reached your destination. Stay safe!", "success");
            }
          }
        }
        const nearest = getNearestPointOnRoute(
          userLngLat,
          normalizedRouteRef.current
        );

        const shouldSnapToRoute = nearest?.point;

        const displayLat = shouldSnapToRoute ? nearest.point[1] : coords.latitude;
        const displayLng = shouldSnapToRoute ? nearest.point[0] : coords.longitude;

        // update marker
        mapRef.current?.showCurrentLocation(displayLat, displayLng);

        updateNavCamera(
          displayLat,
          displayLng,
          normalizedRouteRef.current,
          loc?.coords?.heading,
          loc?.coords?.speed ?? 0
        );

        if (!routeDrawn && mapReady && selectedRoute?.coords?.length) {
          drawRouteOnce();
        }

        if (isNavigating) {
          if (nearest?.distance != null) {
            setLastOffRouteDistance(Math.round(nearest.distance));
            if (nearest.distance > OFF_ROUTE_THRESHOLD_METERS) {
              rerouteFromCurrentLocation(coords);
            }
          }
          updateNavigationStepState(userLngLat, loc?.coords?.speed ?? 0);
        }
        fetchIncidents(coords);
      }
    );
  };

  const startLiveSharing = async (duration) => {
    try {
      const existing = await checkExistingSession();

      if (existing) {
        setTrackingUrl(existing.tracking_url);
        setIsSharing(true);
        await AsyncStorage.setItem("isSharing", "true");

        Alert.alert(
          "Live Location Active",
          "You are already sharing your location",
          [
            {
              text: "Share Again",
              onPress: () =>
                openShareOptions(existing.tracking_url, duration),
            },
            {
              text: "Stop Sharing",
              onPress: stopSharing,
            },
            {
              text: "Start New",
              onPress: () => createNewSession(duration),
            },
          ]
        );

        return;
      }

      createNewSession(duration);

    } catch (e) {
      console.log(e);
    }
  };


  const checkExistingSession = async () => {
    try {
      const stored = await AsyncStorage.getItem("active_tracking_session");
      if (!stored) return null;

      const session = JSON.parse(stored);

      if (session.expires_at) {
        const now = Date.now();
        const expiry = new Date(session.expires_at).getTime();

        if (now > expiry) {
          await AsyncStorage.removeItem("active_tracking_session");
          return null;
        }
      }

      return session;
    } catch (e) {
      return null;
    }
  };

  const openShareOptions = (url, duration) => {
    const msg = getShareMessage(url);

    Alert.alert("Share Live Location", "Choose option", [
      {
        text: "WhatsApp",
        onPress: () =>
          Linking.openURL(`whatsapp://send?text=${encodeURIComponent(msg)}`),
      },
      {
        text: "Share",
        onPress: () => Share.share({ message: msg }),
      },
      {
        text: "Copy Link",
        onPress: async () => {
          await Clipboard.setString(url);
          Alert.alert("Copied", "Tracking link copied");
        },
      },
    ]);
  };

  const createNewSession = async (duration) => {
    try {
      const res = await fetch(`${BASE_URL}/create_tracking_session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: 1,
          user_name: "User",
          latitude: liveLocation.latitude,
          longitude: liveLocation.longitude,
          duration_minutes: duration,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const session = {
          session_id: data.session_id,
          tracking_url: data.tracking_url,
          expires_at:
            duration === 0
              ? null
              : new Date(Date.now() + duration * 60000).toISOString(),
        };

        await AsyncStorage.setItem(
          "active_tracking_session",
          JSON.stringify(session)
        );

        await AsyncStorage.setItem("isSharing", "true");
        setTrackingUrl(data.tracking_url);
        setIsSharing(true);

        toast.showToast(
          "Live tracking started. Your location is being shared.",
          "success"
        );

        openShareOptions(data.tracking_url, duration);
      }
    } catch (e) {
      console.log("Create session error", e);
    }
  };

  const stopSharing = async () => {
    try {
      await AsyncStorage.removeItem("active_tracking_session");
      await AsyncStorage.setItem("isSharing", "false");
      setIsSharing(false);
      setTrackingUrl("");

      toast.showToast("Live tracking stopped.", "info");
    } catch (e) { }
  };

  /* ================= SHARE ================= */
  const getShareMessage = (trackingUrl) => {
    return `🚶‍♀️ HerShield Live Tracking
    
  ${userName || "User"} is sharing their live location.
  
  📍 Current Location:
  https://maps.google.com/?q=${liveLocation?.latitude},${liveLocation?.longitude}
  
  🎯 Destination:
  ${end.lat}, ${end.lng}
  
  🛡️ Route Safety: ${selectedRoute.safety_score}/100
  ⚠️ Risk Zones: ${selectedRoute.incident_count}
  
  ⏱️ Travel Time: ${formatDurationNice(selectedRoute.duration_min)}
  📏 Distance: ${selectedRoute.distance_km.toFixed(2)} km
  
  🔗 Track Live:
  ${trackingUrl}
  
  Stay safe 💜`;
  };

  const handleStartNavigation = () => {
    if (!liveLocation) {
      toast.showToast("Waiting for your live location...", "warning");
      return;
    }

    setIsNavigating(true);
    setFollowUser(true);
    arrivalAnnouncedRef.current = false;

    const routeCoords = selectedRoute?.coords?.map(getLngLatFromPoint).filter(Boolean);
    if (!routeCoords?.length) {
      toast.showToast("Route data unavailable", "error");
      return;
    }

    // Auto-align route starting point with current location if user has moved/drifted
    const startPt = routeCoords[0];
    const userLngLat = [liveLocation.longitude, liveLocation.latitude];
    const distFromStart = approxDistanceMeters(userLngLat, startPt);
    if (distFromStart > 20) {
      rerouteFromCurrentLocation(liveLocation);
    }

    normalizedRouteRef.current = routeCoords;
    const steps = extractSteps(selectedRoute, routeCoords);
    setNavigationSteps(steps);
    currentStepIndexRef.current = 0;
    setCurrentStepIndex(0);
    setCurrentStepDistance(null);
    setLastOffRouteDistance(null);
    lastVoiceStepRef.current = -1;
    if (steps[0]?.instruction) {
      speakText(steps[0].instruction);
    }

    if (routeCoords.length >= 2) {
      mapRef.current?.fitRoute(routeCoords);
    }

    if (navigationStartTimeoutRef.current) {
      clearTimeout(navigationStartTimeoutRef.current);
    }
    navigationStartTimeoutRef.current = setTimeout(() => {
      mapRef.current?.centerMap(
        liveLocation.latitude,
        liveLocation.longitude,
        { zoom: 18 }
      );
    }, 450);
  };

  /* ================= UI ================= */
  const nextInstructionText = formatInstructionWithDistance(
    navigationSteps[currentStepIndex]?.instruction || "Follow the highlighted route",
    currentStepDistance
  );

  return (
    <View style={{ flex: 1 }}>
      <WebMapComponent
        ref={mapRef}
        onMapMessage={(e) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data);

            if (msg.type === "MAP_READY") {
              console.log("✅ MAP READY");
              setMapReady(true);
            }

            if (msg.type === "MAP_DRAG") {
              if (isNavigating) {
                setFollowUser(false);
              }
            }

          } catch { }
        }}
      />

      {/* TOP INFO */}
      <View style={styles.topCard}>
        <Text style={styles.title}>
          🛡 {selectedRoute.safety_score}/100
        </Text>
        <Text style={styles.sub}>
          {selectedRoute.distance_km.toFixed(2)} km •{" "}
          {formatDurationNice(selectedRoute.duration_min)}
        </Text>
      </View>
      {isNavigating && (
        <View style={styles.instructionCard}>
          <Text style={styles.instructionTitle}>
            {isRerouting ? "Rerouting..." : "Next instruction"}
          </Text>
          <Text style={styles.instructionText}>
            {nextInstructionText}
          </Text>
          <Text style={styles.instructionMeta}>
            Step {Math.min(currentStepIndex + 1, Math.max(navigationSteps.length, 1))}/{Math.max(navigationSteps.length, 1)}
            {currentStepDistance != null ? `  •  ${currentStepDistance} m` : ""}
            {distanceToDestination != null ? `  •  ${distanceToDestination} m to destination` : ""}
            {lastOffRouteDistance != null ? `  •  Route offset ${lastOffRouteDistance} m` : ""}
          </Text>
        </View>
      )}

      {/* FLOATING CONTROLS */}
      <MapFloatingControls
        onLocate={() => {
          setFollowUser(true);

          if (liveLocation) {
            mapRef.current?.centerMap(
              liveLocation.latitude,
              liveLocation.longitude
            );
          }
        }}
        onReset={() => {
          if (!mapReady) return;
          mapRef.current?.resetToKarnataka();
        }}
      />

      {/* Start + nearby reports: anchored to bottom (reports lowest) */}
      <View
        style={[
          styles.navBottomStack,
          { bottom: Math.max(insets.bottom, 8) + 76 },
        ]}
      >
        <TouchableOpacity
          style={styles.startBtn}
          onPress={handleStartNavigation}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Ionicons name="navigate" size={20} color="#fff" />

            <Text
              style={{
                color: "#fff",
                fontWeight: "800",
                fontSize: 16,
                marginLeft: 8,
              }}
            >
              {isNavigating ? "Navigating..." : "Start Navigation"}
            </Text>
          </View>
        </TouchableOpacity>

        {nearbyReportItems.length > 0 && !showReportsPanel && (
          <TouchableOpacity
            style={styles.reportsShowBar}
            onPress={() => setShowReportsPanel(true)}
            activeOpacity={0.85}
          >
            <Ionicons
              name="chevron-up"
              size={18}
              color="#FFB74D"
              style={{ marginRight: 8 }}
            />
            <Text style={styles.reportsShowBarText}>
              Nearby reports ({nearbyReportItems.length})
            </Text>
          </TouchableOpacity>
        )}

        {nearbyReportItems.length > 0 && showReportsPanel && (
          <View style={styles.reportsStrip} pointerEvents="box-none">
            <View style={styles.reportsStripHeaderRow}>
              <Text style={styles.reportsStripTitle} numberOfLines={1}>
                Nearby reports ({nearbyReportItems.length})
              </Text>
              <TouchableOpacity
                style={styles.reportsHideBtnWrap}
                onPress={() => setShowReportsPanel(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.reportsHideLabel}>Hide</Text>
                <Ionicons
                  name="chevron-down"
                  size={20}
                  color="#FFB74D"
                  style={{ marginLeft: 4 }}
                />
              </TouchableOpacity>
            </View>
            <Text style={styles.reportsStripHint}>
              Scroll for details · Hide for full map
            </Text>
            <ScrollView
              style={styles.reportsStripScroll}
              contentContainerStyle={styles.reportsStripScrollContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
            >
              {nearbyReportItems.map((item) => (
                <View key={String(item.id)} style={styles.reportCard}>
                  <Text style={styles.reportCardType} numberOfLines={2}>
                    {item.incident_type}
                  </Text>
                  <Text style={styles.reportCardDesc}>
                    {item.description || "No description provided"}
                  </Text>
                  {item.place_name ? (
                    <Text style={styles.reportCardPlace}>
                      📍 {item.place_name}
                    </Text>
                  ) : (
                    <Text style={styles.reportCardPlaceMuted}>
                      📍 Location on map
                    </Text>
                  )}
                  <Text style={styles.reportCardDist}>
                    {item.distanceM < 1000
                      ? `${Math.round(item.distanceM)} m away`
                      : `${(item.distanceM / 1000).toFixed(1)} km away`}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {/* ACTION BUTTONS */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.shareBtn}
          onPress={() => setShareVisible(true)}
        >
          <Ionicons name="share-social" size={22} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.sosBtn}
          onPress={() => navigation.navigate("SOS")}
        >
          <Text style={styles.sosText}>SOS</Text>
        </TouchableOpacity>
      </View>

      {/* SHARE MODAL */}
      <Modal visible={shareVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>

            {isSharing ? (
              /* ================= ACTIVE SHARING UI ================= */
              <>
                <Text style={styles.modalTitle}>Live Location Active</Text>

                <Text style={{ color: "green", marginBottom: 15 }}>
                  ● You are currently sharing your location

                </Text>
                <Text style={{ marginBottom: 10, color: "#555" }}>
                  ⏱ {remainingTime}
                </Text>

                <TouchableOpacity
                  style={styles.option}
                  onPress={() => openShareOptions(trackingUrl, 0)}
                >
                  <Text>Share Again</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.option}
                  onPress={stopSharing}
                >
                  <Text style={{ color: "red" }}>Stop Sharing</Text>
                </TouchableOpacity>
              </>
            ) : (
              /* ================= NORMAL SHARE UI ================= */
              <>
                <Text style={styles.modalTitle}>Share Live Location</Text>

                <View style={styles.timeRow}>
                  {[15, 30, 45, 60].map((t) => (
                    <TouchableOpacity
                      key={t}
                      style={[
                        styles.timeBtn,
                        selectedDuration === t && styles.activeTime,
                      ]}
                      onPress={() => startLiveSharing(t)}
                    >
                      <Text>{t} min</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* UNTIL STOP */}
                <TouchableOpacity
                  style={styles.option}
                  onPress={() => startLiveSharing(0)}
                >
                  <Text>Until I stop</Text>
                </TouchableOpacity>

                {/* CUSTOM */}
                <View style={{ flexDirection: "row", marginTop: 10 }}>
                  <TextInput
                    placeholder="Custom minutes"
                    keyboardType="numeric"
                    value={customTime}
                    onChangeText={setCustomTime}
                    style={{
                      flex: 1,
                      borderWidth: 1,
                      borderColor: "#ccc",
                      padding: 10,
                      borderRadius: 10,
                    }}
                  />
                  <TouchableOpacity
                    style={{
                      backgroundColor: "#570a1c",
                      padding: 10,
                      marginLeft: 10,
                      borderRadius: 10,
                    }}
                    onPress={() => {
                      if (customTime) startLiveSharing(parseInt(customTime));
                    }}
                  >
                    <Text style={{ color: "#fff" }}>Start</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* CLOSE BUTTON (COMMON) */}
            <TouchableOpacity
              style={styles.close}
              onPress={() => setShareVisible(false)}
            >
              <Text style={{ color: "#fff" }}>Close</Text>
            </TouchableOpacity>

          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ================= STYLES ================= */

const styles = StyleSheet.create({
  topCard: {
    position: "absolute",
    top: 50,
    left: 16,
    right: 16,
    backgroundColor: "rgba(20,20,20,0.55)",
    padding: 16,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
  },

  title: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 20,
  },

  sub: {
    color: "#d1d1d1",
    marginTop: 4,
    fontSize: 13,
  },

  actions: {
    position: "absolute",
    bottom: 30,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  shareBtn: {
    backgroundColor: "#6A0D1B",
    padding: 16,
    borderRadius: 50,
    elevation: 10,
  },

  sosBtn: {
    backgroundColor: "#FF3B30",
    paddingVertical: 16,
    paddingHorizontal: 22,
    borderRadius: 30,
    elevation: 12,
  },

  sosText: {
    color: "#fff",
    fontWeight: "700",
  },

  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },

  modal: {
    backgroundColor: "#fff",
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },

  modalTitle: {
    fontWeight: "700",
    marginBottom: 10,
  },

  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  timeBtn: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#eee",
  },

  activeTime: {
    backgroundColor: "#570a1c",
  },

  option: {
    padding: 14,
    borderBottomWidth: 1,
    borderColor: "#eee",
  },

  close: {
    backgroundColor: "#570a1c",
    padding: 14,
    borderRadius: 10,
    marginTop: 10,
    alignItems: "center",
  },
  startBtn: {
    backgroundColor: "#1E88E5",
    paddingVertical: 18,
    borderRadius: 20,
    alignItems: "center",

    shadowColor: "#1E88E5",
    shadowOpacity: 0.7,
    shadowRadius: 20,
    elevation: 15,
  },
  instructionCard: {
    position: "absolute",
    top: 50,
    left: 16,
    right: 16,
    backgroundColor: "rgba(15,15,15,0.86)",
    borderRadius: 14,
    padding: 12,
  },
  instructionTitle: {
    color: "#4FC3F7",
    fontWeight: "700",
    fontSize: 12,
    marginBottom: 4,
  },
  instructionText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
  instructionMeta: {
    color: "#d2d2d2",
    marginTop: 6,
    fontSize: 12,
  },
  navBottomStack: {
    position: "absolute",
    left: 12,
    right: 12,
  },
  reportsShowBar: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18,18,18,0.92)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    elevation: 6,
  },
  reportsShowBarText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
    flexShrink: 1,
  },
  reportsStrip: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 188,
    left: 12,
    right: 12,
    bottom: 188,
    maxHeight: 268,
    backgroundColor: "rgba(18,18,18,0.92)",
    borderRadius: 14,
    paddingTop: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  reportsStripHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  reportsStripTitle: {
    color: "#FFB74D",
    fontWeight: "700",
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  reportsStripHint: {
    color: "#9e9e9e",
    fontSize: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  reportsHideBtnWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingLeft: 8,
  },
  reportsHideLabel: {
    color: "#FFB74D",
    fontWeight: "700",
    fontSize: 12,
  },
  reportsStripScroll: {
    maxHeight: 210,
    paddingHorizontal: 4,
  },
  reportsStripScrollContent: {
    paddingHorizontal: 10,
    paddingBottom: 6,
  },
  reportCard: {
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  reportCardType: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
    marginBottom: 4,
  },
  reportCardDesc: {
    color: "#e0e0e0",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  reportCardPlace: {
    color: "#90CAF9",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    fontWeight: "600",
  },
  reportCardPlaceMuted: {
    color: "#78909C",
    fontSize: 11,
    marginTop: 10,
    fontStyle: "italic",
  },
  reportCardDist: {
    color: "#B0BEC5",
    fontSize: 11,
    marginTop: 8,
    fontWeight: "700",
  },
});