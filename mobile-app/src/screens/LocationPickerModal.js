import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
} from "react-native";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";

import AppHeader from "../components/AppHeader";
import GradientButton from "../components/GradientButton";
import WebMapComponent from "../components/WebMapComponent";
import MapFloatingControls from "../components/MapFloatingControls";
import { useToast } from "../context/ToastContext";
import { GEOAPIFY_KEY } from "../utils/config";
import { BASE_URL } from "../utils/config";

const KARNATAKA_BOUNDS = {
  minLat: 11.5,
  maxLat: 18.45,
  minLng: 74.0,
  maxLng: 78.6,
};

export default function LocationPicker({ onClose, onLocationSelected }) {
  const mapRef = useRef(null);
  const searchDebounceRef = useRef(null);
  const { showToast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedCoord, setSelectedCoord] = useState(null);
  const [selectedPlaceName, setSelectedPlaceName] = useState("");
  const [locationMethod, setLocationMethod] = useState(null);
  const [isLocationInKarnataka, setIsLocationInKarnataka] = useState(true);
  const [userLocation, setUserLocation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [incidents, setIncidents] = useState([]);

  const isInKarnataka = (lat, lng) =>
    lat >= KARNATAKA_BOUNDS.minLat &&
    lat <= KARNATAKA_BOUNDS.maxLat &&
    lng >= KARNATAKA_BOUNDS.minLng &&
    lng <= KARNATAKA_BOUNDS.maxLng;

  useEffect(() => {
    getCurrentLocation();
  }, []);

  const getCurrentLocation = async () => {
    try {
      setIsLoading(true);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        showToast("Location permission required", "error");
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;

      setUserLocation({ latitude: lat, longitude: lng });
      setLocationMethod("live");

      mapRef.current?.showCurrentLocation(lat, lng);

      const inside = isInKarnataka(lat, lng);
      setIsLocationInKarnataka(inside);

      if (inside) {
        setSelectedCoord({ latitude: lat, longitude: lng });
        const address = await reverseGeocode(lat, lng);
        setSelectedPlaceName(address);
      }
    } catch (e) {
      console.error("Location error:", e);
    } finally {
      setIsLoading(false);
    }
  };
  const fetchIncidents = async () => {
    try {
      const res = await fetch(`${BASE_URL}/incidents/recent`);
      const data = await res.json();
  
      if (data?.success && data.incidents) {
        setIncidents(data.incidents);
        mapRef.current?.addIncidents(data.incidents);
      }
    } catch (e) {
      console.log("Incident fetch error", e);
    }
  };
  
  const handleMapMessage = (event) => {
    const msg = JSON.parse(event.nativeEvent.data);

    if (msg.type === "MAP_READY") {
      if (userLocation) {
        mapRef.current?.showCurrentLocation(
          userLocation.latitude,
          userLocation.longitude
        );
      }
      fetchIncidents();
    }
  
    if (msg.type === "mapClick") {
      const { lat, lng } = msg.coord;

      const inside = isInKarnataka(lat, lng);
      setIsLocationInKarnataka(inside);
      setLocationMethod("manual");
      setSelectedCoord({ latitude: lat, longitude: lng });

      reverseGeocode(lat, lng).then(setSelectedPlaceName);
    }
  };

  const searchLocation = (text) => {
    setSearchQuery(text);

    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (text.length < 2) return setSearchResults([]);

    searchDebounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const url =
          `https://api.geoapify.com/v1/geocode/autocomplete?` +
          `text=${encodeURIComponent(text)}&` +
          `filter=rect:${KARNATAKA_BOUNDS.minLng},${KARNATAKA_BOUNDS.minLat},${KARNATAKA_BOUNDS.maxLng},${KARNATAKA_BOUNDS.maxLat}&` +
          `bias=countrycode:in&limit=6&apiKey=${GEOAPIFY_KEY}`;

        const res = await fetch(url);
        const data = await res.json();
        setSearchResults(data.features || []);
      } catch {
        setSearchResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);
  };

  const handleSelectSearchResult = async (item) => {
    const lat = parseFloat(item.properties.lat);
    const lng = parseFloat(item.properties.lon);

    setLocationMethod("search");
    setSelectedCoord({ latitude: lat, longitude: lng });

    const inside = isInKarnataka(lat, lng);

    setSelectedCoord({ latitude: lat, longitude: lng });
    setIsLocationInKarnataka(inside);
    setLocationMethod("search");

    mapRef.current?.centerMap(lat, lng);
    reverseGeocode(lat, lng).then(setSelectedPlaceName);

    const address = await reverseGeocode(lat, lng);
    setSelectedPlaceName(address);

    setSearchResults([]);
    setSearchQuery("");
    setShowSearchBar(false);
  };

  const handleConfirm = () => {
    if (!selectedCoord) {
      showToast("Please select a location first", "error");
      return;
    }
  
    if (!isLocationInKarnataka) {
      Alert.alert(
        "Outside Karnataka",
        "Incident reporting is currently supported only within Karnataka."
      );
      return;
    }
  
    onLocationSelected({
      ...selectedCoord,
      placeName: selectedPlaceName,
      method: locationMethod,
      isInKarnataka: true,
      timestamp: new Date().toISOString(),
    });
  };
  

  const reverseGeocode = async (lat, lng) => {
    try {
      const res = await fetch(
        `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${GEOAPIFY_KEY}`
      );
      const data = await res.json();
      return data.features?.[0]?.properties?.formatted || "";
    } catch {
      return "";
    }
  };

  return (
    <>
      <AppHeader title="Select Location" showBack={true} onBack={onClose} variant="dark" showProfile={false} />

      <View style={{ flex: 1 }}>
        {showSearchBar && (
          <View style={styles.searchBox}>
            <TextInput
              placeholder="Search locations in Karnataka…"
              value={searchQuery}
              onChangeText={searchLocation}
              style={styles.searchInput}
            />
            {isLoading && <ActivityIndicator size="small" />}
          </View>
        )}
        {searchResults.length > 0 && (
  <View style={styles.resultsContainer}>
    <FlatList
      data={searchResults}
      keyExtractor={(item, index) => item.properties.place_id || index.toString()}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => {
        const props = item.properties;

        return (
          <TouchableOpacity
            style={styles.resultItem}
            onPress={() => handleSelectSearchResult(item)}
          >
            <Ionicons name="location-outline" size={20} color="#6d1233" />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.resultTitle} numberOfLines={1}>
                {props.name || props.street || props.city || "Location"}
              </Text>
              <Text style={styles.resultSubTitle} numberOfLines={2}>
                {props.formatted}
              </Text>
            </View>
          </TouchableOpacity>
        );
      }}
      />
    </View>
  )}

        <WebMapComponent ref={mapRef} onMapMessage={handleMapMessage} />

        {selectedCoord && (
          <View style={styles.infoBox}>
            <Text style={styles.coordText}>
              {selectedCoord.latitude.toFixed(6)},{" "}
              {selectedCoord.longitude.toFixed(6)}
            </Text>
            <Text numberOfLines={2}>{selectedPlaceName}</Text>
            {!isLocationInKarnataka && (
              <Text style={styles.warningText}>
                Reporting is currently available only within Karnataka.
              </Text>
            )}
          </View>
        )}

        <View style={styles.bottomBar}>
          <GradientButton
            text={
              isLocationInKarnataka
                ? "Confirm Location"
                : "Outside Karnataka"
            }
            onPress={handleConfirm}
            disabled={!selectedCoord || !isLocationInKarnataka}
          />
        </View>

        <MapFloatingControls
        onLocate={getCurrentLocation}
        onReset={() => mapRef.current?.resetToKarnataka()}
        onSearch={() => setShowSearchBar(true)}
        incidentCount={0}
      />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    padding: 10,
    backgroundColor: "#fff",
  },
  searchInput: {
    backgroundColor: "#f2f2f2",
    borderRadius: 8,
    padding: 10,
  },
  infoBox: {
    padding: 12,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderColor: "#eee",
  },
  coordText: {
    fontWeight: "600",
  },
  warningText: {
    marginTop: 4,
    color: "red",
  },
  bottomBar: {
    padding: 12,
    backgroundColor: "#fff",
  },
  resultsContainer: {
    position: "absolute",
    top: 60,
    left: 10,
    right: 10,
    backgroundColor: "#fff",
    borderRadius: 12,
    maxHeight: 300,
    zIndex: 20,
    elevation: 8,
  },
  resultItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  resultTitle: {
    fontWeight: "600",
    fontSize: 14,
    color: "#222",
  },
  resultSubTitle: {
    fontSize: 12,
    color: "#666",
  }, 
});