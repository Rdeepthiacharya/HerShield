import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { LineChart } from "react-native-chart-kit";
import AppHeader from "../components/AppHeader";
import { RouteService } from "../services/RouteService";

const { width } = Dimensions.get("window");

const SPEEDS = {
  walk: 4,
  vehicle: 20,
};

export default function RouteDetailsScreen({ onClose, navigation, route }) {
  const { end, locationName } = route.params;

  const [currentLocation, setCurrentLocation] = useState(null);
  const [currentAddress, setCurrentAddress] = useState("Fetching...");
  const [routes, setRoutes] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState("walk");
  const [loading, setLoading] = useState(true);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  const selectedRoute = routes[selectedIndex];

  /* ================= MONTHS ================= */
  const getLast6Months = () => {
    const now = new Date();
    const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const arr = [];

    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      arr.push(`${names[d.getMonth()]} ${d.getFullYear()}`);
    }

    return arr;
  };

  /* ================= HELPERS ================= */

  const calculateETA = (distance, mode, incidents = 0) => {
    const base = (distance / SPEEDS[mode]) * 60;
    const risk = Math.min(incidents * 0.05, 0.4);
    return Math.round(base * (1 + risk));
  };

  const getSafetyColor = (score) => {
    if (score >= 80) return "#4CAF50";
    if (score >= 60) return "#FF9800";
    if (score >= 40) return "#FFC107";
    return "#F44336";
  };

  const getSafetyLabel = (score) => {
    if (score >= 80) return "Very Safe";
    if (score >= 60) return "Moderate";
    if (score >= 40) return "Risky";
    return "High Risk";
  };

  const generateSafetyTrend = (score) => {
    const base = Math.max(60, score - 15);
    return [base - 2, base - 1, base, base + 1, base + 3, score];
  };

  const formatTime = (min) => {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}h ${m}m`;
  };

  /* ================= LOCATION ================= */

  const getAddress = async (lat, lng) => {
    try {
      const res = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (res.length > 0) {
        const a = res[0];
        return `${a.name || ""}, ${a.city || ""}, ${a.region || ""}`;
      }
      return `${lat}, ${lng}`;
    } catch {
      return `${lat}, ${lng}`;
    }
  };

  const getCurrentLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;

    const loc = await Location.getCurrentPositionAsync({});
    const { latitude, longitude } = loc.coords;

    setCurrentLocation({ lat: latitude, lng: longitude });

    const addr = await getAddress(latitude, longitude);
    setCurrentAddress(addr);
  };

  /* ================= FETCH ROUTES ================= */

  const fetchRoutes = useCallback(async () => {
    if (!currentLocation || !end) return;

    try {
      setLoading(true);

      const res = await RouteService.getMultipleRoutes(
        { latitude: currentLocation.lat, longitude: currentLocation.lng },
        { latitude: end.lat, longitude: end.lng },
        mode
      );

      if (!res.success) throw new Error();

      const formatted = res.routes.map((r) => ({
        ...r,
        duration_min: calculateETA(r.distance_km, mode, r.incident_count),
        color: getSafetyColor(r.safety_score),
      }));

      setRoutes(formatted);
      setSelectedIndex(0);
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
    }
  }, [currentLocation, end, mode]);

  useEffect(() => {
    getCurrentLocation();
  }, []);

  useEffect(() => {
    fetchRoutes();
  }, [currentLocation, mode]);

  /* ================= ANIMATION ================= */

  useEffect(() => {
    fadeAnim.setValue(0);
    scaleAnim.setValue(0.95);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        useNativeDriver: true,
      }),
    ]).start();
  }, [selectedIndex]);

  /* ================= CHART ================= */

  const chartData = useMemo(() => ({
    labels: getLast6Months(),
    datasets: [
      {
        data: generateSafetyTrend(selectedRoute?.safety_score || 80),
        strokeWidth: 3,
      },
    ],
  }), [selectedRoute]);

  /* ================= UI ================= */

  if (loading || routes.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#570a1c" />
        <Text>Finding safest routes...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader
        title="Safety Overview"
        showBack={true}
        onBack={onClose}
        variant="dark"
        showProfile={false}
      />

      <ScrollView>

        {/* LOCATION */}
        <View style={styles.card}>
          <Text style={styles.label}>Current Location</Text>
          <Text style={styles.value}>{currentAddress}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Destination</Text>
          <Text style={styles.value}>{locationName}</Text>
        </View>

        {/* MODE */}
        <View style={styles.modeRow}>
          {["walk", "vehicle"].map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => setMode(m)}
              style={[styles.modeBtn, mode === m && styles.modeActive]}
            >
              <Ionicons name={m === "walk" ? "walk" : "car"} size={18} color={mode === m ? "#fff" : "#333"} />
              <Text style={{ color: mode === m ? "#fff" : "#333", marginLeft: 6 }}>{m}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ROUTES */}
        {routes.map((r, idx) => (
          <TouchableOpacity
            key={idx}
            onPress={() => setSelectedIndex(idx)}
            style={[
              styles.routeCard,
              selectedIndex === idx && styles.selectedCard,
            ]}
          >
            <View style={styles.rowBetween}>
              <Text style={styles.routeTitle}>Route {idx + 1}</Text>
              {idx === 0 && <Text style={styles.badge}>Best (Safe)</Text>}
            </View>

            <View style={styles.rowBetween}>
              <Text>📏 {r.distance_km.toFixed(2)} km</Text>
              <Text>⏱ {formatTime(r.duration_min)}</Text>
            </View>

            <View style={styles.rowBetween}>
              <Text style={{ color: r.color }}>
                🛡 {r.safety_score}/100
              </Text>
              <Text>⚠️ {r.incident_count}</Text>
            </View>
          </TouchableOpacity>
        ))}

        {/* SAFETY TREND */}
        <Animated.View
          style={[
            styles.trendCard,
            { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          <Text style={styles.trendTitle}>Safety Trend</Text>

          <View style={styles.chartWrapper}>
          <LineChart
          data={chartData}
          width={width - 60}
          height={200}
          fromZero
          segments={4}
          bezier
          withDots={true}
          verticalLabelRotation={-25}
          chartConfig={{
            backgroundColor: "#fff",
            backgroundGradientFrom: "#fff",
            backgroundGradientTo: "#fff",
            decimalPlaces: 0,
            color: () => selectedRoute.color,
            strokeWidth: 4,
            fillShadowGradient: selectedRoute.color,
            fillShadowGradientOpacity: 0.15, 
            labelColor: () => "#666",
            propsForDots: {
              r: "5",
              strokeWidth: "2",
              stroke: "#fff",
            },
            propsForBackgroundLines: {
              stroke: "#999",
              strokeDasharray: "3",
            },
          }}
          style={{
            borderRadius: 16,
          }}
        />
          </View>

          {/* LEGEND */}
          <View style={styles.legend}>
            {[
              { label: "Safe", color: "#4CAF50" },
              { label: "Moderate", color: "#FF9800" },
              { label: "Risky", color: "#FFC107" },
              { label: "Danger", color: "#F44336" },
            ].map((item, i) => (
              <View key={i} style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: item.color }]} />
                <Text style={styles.legendText}>{item.label}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        {/* START */}
        <TouchableOpacity
          style={styles.startBtn}
          onPress={() =>
            navigation.navigate("Navigation", {
              selectedRoute,
              end,
            })
          }
        >
          <Text style={styles.startText}>Start Navigation</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  card: {
    backgroundColor: "#fff",
    margin: 12,
    padding: 14,
    borderRadius: 12,
  },

  label: { fontSize: 12, color: "#666" },
  value: { fontSize: 14, fontWeight: "600" },

  modeRow: { flexDirection: "row", justifyContent: "center" },

  modeBtn: {
    paddingVertical: 15,
    paddingHorizontal: 45,
    margin: 6,
    backgroundColor: "#eee",
    borderRadius: 10,
    flexDirection: "row",
  },

  modeActive: { backgroundColor: "#570a1c" },

  routeCard: {
    backgroundColor: "#fff",
    margin: 12,
    padding: 16,
    borderRadius: 16,
  },

  selectedCard: {
    borderWidth: 2,
    borderColor: "#570a1c",
  },

  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },

  routeTitle: { fontWeight: "700" },

  badge: {
    backgroundColor: "#4CAF50",
    color: "#fff",
    paddingHorizontal: 6,
    borderRadius: 6,
  },

  trendCard: {
    backgroundColor: "#fff",
    margin: 12,
    padding: 16,
    borderRadius: 18,
    elevation: 4,
  },

  trendTitle: { fontWeight: "700", marginBottom: 10 },

  chartWrapper: {
    borderRadius: 16,
    overflow: "hidden",
  },

  chart: {
    borderRadius: 16,
  },

  legend: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 12,
  },

  legendItem: {
    flexDirection: "row",
    alignItems: "center",
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 5,
  },

  legendText: {
    fontSize: 11,
    color: "#666",
  },

  startBtn: {
    backgroundColor: "#570a1c",
    margin: 16,
    padding: 15,
    borderRadius: 12,
    alignItems: "center",
  },

  startText: {
    color: "#fff",
    fontWeight: "600",
  },
});