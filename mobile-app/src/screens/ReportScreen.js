import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { Picker } from "@react-native-picker/picker";
import { MaterialIcons, FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useToast } from "../context/ToastContext";

import AppHeader from "../components/AppHeader";
import BottomNav from "../components/BottomNav";
import LocationPickerModal from "./LocationPickerModal";
import GradientButton from "../components/GradientButton";

import { BASE_URL } from "../utils/config";

export default function ReportScreen({ navigation }) {
  const toast = useToast();
  const appState = useRef(AppState.currentState);

  const [location, setLocation] = useState("");
  const [manualLatLng, setManualLatLng] = useState(null);
  const [incidentType, setIncidentType] = useState("");
  const [comment, setComment] = useState("");
  const [placeName, setPlaceName] = useState("");
  const [pickerVisible, setPickerVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(true);
  const [selectedLocationData, setSelectedLocationData] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    loadUser();
    getCurrentLocation();
  }, []);

  const loadUser = async () => {
    try {
      const userJson = await AsyncStorage.getItem('user');
      if (userJson) {
        setUser(JSON.parse(userJson));
      }
    } catch (error) {
      console.error('Error loading user:', error);
    }
  };

  const getCurrentLocation = async () => {
    try {
      setLocationLoading(true);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        toast.showToast("Location permission required", "error");
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const lat = loc.coords.latitude;
      const lon = loc.coords.longitude;

      const coords = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      setManualLatLng({ latitude: lat, longitude: lon });
      setLocation(coords);

      getPlaceNameForCoordinates(lat, lon);

    } catch (error) {
      console.error("Location error:", error);
      toast.showToast("Could not fetch GPS", "error");
    } finally {
      setLocationLoading(false);
    }
  };

  const getPlaceNameForCoordinates = async (lat, lon) => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;

      const res = await fetch(url, {
        headers: { "User-Agent": "HerShield/1.0", "Accept-Language": "en" },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.display_name) {
          setPlaceName(data.display_name);
        }
      }
    } catch (error) {
      console.log("Reverse geocoding error:", error);
    }
  };

  const handlePickLocation = () => setPickerVisible(true);

  const handleLocationSelected = (locationData) => {
    if (!locationData) return;

    setManualLatLng({
      latitude: locationData.latitude,
      longitude: locationData.longitude,
    });

    const coords = `${locationData.latitude.toFixed(4)}, ${locationData.longitude.toFixed(4)}`;
    setLocation(coords);

    if (locationData.placeName) {
      setPlaceName(locationData.placeName);
    } else {

      getPlaceNameForCoordinates(locationData.latitude, locationData.longitude);
    }

    setSelectedLocationData(locationData);
    setPickerVisible(false);
    toast.showToast("Location selected", "info");
  };

  const handleSubmit = async () => {
    if (!location || !incidentType) {
      toast.showToast("Fill all required fields", "error");
      return;
    }

    if (selectedLocationData && !selectedLocationData.isInKarnataka) {
      toast.showToast("Location must be in Karnataka", "error");
      return;
    }

    if (!user) {
      toast.showToast("Please login to submit reports", "error");
      navigation.navigate("Auth");
      return;
    }

    await submitReport();
  };

  const submitReport = async () => {
    setLoading(true);
    try {
      const lat = manualLatLng
        ? manualLatLng.latitude
        : parseFloat(location.split(",")[0]);
      const lng = manualLatLng
        ? manualLatLng.longitude
        : parseFloat(location.split(",")[1]);

      const payload = {
        latitude: lat,
        longitude: lng,
        incident_type: incidentType,
        description: comment,
        place_name: placeName || "",
        severity: 1,
        location_type: selectedLocationData?.method === 'live' ? 'gps_auto' : 'manual_select',
        user_id: user.id,
      };

      console.log("Submitting report:", payload);

      const res = await fetch(`${BASE_URL}/submit_report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const responseText = await res.text();
      console.log("Server response:", responseText);

      const data = JSON.parse(responseText);

      if (data.success) {
        toast.showToast("Report submitted successfully!", "success");

        setIncidentType("");
        setComment("");
        setPlaceName("");
        setSelectedLocationData(null);
        setLocation("");
        setManualLatLng(null);
      } else {
        toast.showToast(data.message || data.error || "Report failed", "error");
      }
    } catch (error) {
      console.error("Full error:", error);
      toast.showToast("Server unreachable. Check connection.", "error");
    } finally {
      setLoading(false);
    }
  };

  const reCenterToCurrentLocation = () => {
    if (manualLatLng) {
      toast.showToast("Recentered to current location", "info");
    } else {
      getCurrentLocation();
    }
  };

  return (
    <>
      <AppHeader title="HerShield Report" />

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>
          <View style={styles.userStatusContainer}>
            {user ? (
              <View style={styles.loggedInBadge}>
                <Ionicons name="person-circle" size={18} color="#4CAF50" />
                <Text style={styles.loggedInText}>
                  Logged in as: {user.fullname || user.email_id}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📍 Location</Text>
            <View style={styles.locationContainer}>
              <View style={styles.locationHeader}>
                <Ionicons name="information-circle" size={18} color="#4CAF50" />
                <Text style={styles.karnatakaNotice}>
                  Incident reporting available only in Karnataka
                </Text>
              </View>

              <View style={styles.locationDisplay}>
                <Text style={styles.locationLabel}>Selected Place:</Text>
                <Text style={styles.placeName} numberOfLines={2}>
                  {placeName || "Not selected"}
                </Text>
                <Text style={styles.coordinates}>
                  Coordinates: {location || "Not selected"}
                </Text>

                {selectedLocationData && (
                  <View style={styles.locationMethodBadge}>
                    <Ionicons
                      name={selectedLocationData.method === 'live' ? "location" :
                        selectedLocationData.method === 'search' ? "search" : "pin"}
                      size={14}
                      color="#4CAF50"
                    />
                    <Text style={styles.locationMethodText}>
                      {selectedLocationData.method === 'live' ? 'Current Location' :
                        selectedLocationData.method === 'search' ? 'Searched' : 'Map Selected'}
                    </Text>
                    {selectedLocationData.isInKarnataka && (
                      <View style={styles.karnatakaBadge}>
                        <Text style={styles.karnatakaBadgeText}>✓ Karnataka</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>

              <GradientButton
                text="Select Location"
                onPress={handlePickLocation}
                loading={locationLoading}
                disabled={locationLoading}
                icon={<Ionicons name="map" size={20} color="#fff" />}
              />

            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>⚠️ Incident Type</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={incidentType}
                onValueChange={setIncidentType}
              >
                <Picker.Item label="Select incident type" value="" />
                <Picker.Item label="Harassment" value="harassment" />
                <Picker.Item label="Eve Teasing" value="eve_teasing" />
                <Picker.Item label="Stalking" value="stalking" />
                <Picker.Item label="Verbal Abuse" value="verbal_abuse" />
                <Picker.Item label="Physical Assault" value="physical_assault" />
                <Picker.Item label="Suspicious Activity" value="suspicious" />
                <Picker.Item label="Robbery/Theft" value="theft" />
                <Picker.Item label="Other" value="other" />
              </Picker>
            </View>
          </View>


          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📝 Description (Optional)</Text>
            <TextInput
              style={styles.descriptionInput}
              value={comment}
              onChangeText={setComment}
              placeholder="Provide additional details about the incident..."
              placeholderTextColor="#999"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          <View style={styles.submitSection}>
            <GradientButton
              text={user ? "Submit Report" : "Submit Anonymously"}
              onPress={handleSubmit}
              loading={loading}
              disabled={!incidentType || !location || loading}
              icon={<Ionicons name="shield-checkmark" size={22} color="#fff" />}
            />


            <Text style={styles.disclaimer}>
              ✓ Your report will help make Karnataka safer for women
              {user ? " (Linked to your account)" : " (Anonymous report)"}
            </Text>
          </View>
        </View>
      </ScrollView>

      <Modal visible={pickerVisible} animationType="slide">
        <LocationPickerModal
          onClose={() => setPickerVisible(false)}
          onLocationSelected={handleLocationSelected}
        />
      </Modal>

      <BottomNav active="Report" navigation={navigation} />
    </>
  );
}

const styles = StyleSheet.create({
  form: {
    padding: 20,
    backgroundColor: '#f8f9fa',
    flex: 1
  },
  userStatusContainer: {
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  loggedInBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    padding: 12,
    borderRadius: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  loggedInText: {
    fontSize: 14,
    color: '#2E7D32',
    fontWeight: '500',
    flex: 1,
  },
  section: {
    marginBottom: 24,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 12,
    color: '#333'
  },
  locationContainer: {
    backgroundColor: "#fff",
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },
  karnatakaNotice: {
    fontSize: 13,
    color: '#2E7D32',
    fontWeight: '500',
    flex: 1,
  },
  locationDisplay: {
    backgroundColor: '#f8f9fa',
    padding: 14,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  locationLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  placeName: {
    fontSize: 15,
    fontWeight: "600",
    color: '#333',
    marginBottom: 6,
  },
  coordinates: {
    fontSize: 13,
    color: "#444",
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 8,
  },
  locationMethodBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  locationMethodText: {
    fontSize: 12,
    color: '#4CAF50',
    fontWeight: '500',
  },
  karnatakaBadge: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 'auto',
  },
  karnatakaBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  pickerWrapper: {
    borderWidth: 1,
    borderColor: '#dee2e6',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#f8f9fa',
  },
  descriptionInput: {
    borderWidth: 1,
    borderColor: '#dee2e6',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    minHeight: 100,
    backgroundColor: '#f8f9fa',
    color: '#333',
  },
  submitSection: {
    marginTop: 20,
    alignItems: 'center',
  },
  disclaimer: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 12,
    fontStyle: 'italic',
  },
});