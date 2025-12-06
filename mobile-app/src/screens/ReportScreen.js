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

  // Load user and current location on component mount
  useEffect(() => {
    loadUser();
    getCurrentLocation();
  }, []);

  // Get current user from AsyncStorage
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

  // Get current location
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
      
      // Get place name for current location
      getPlaceNameForCoordinates(lat, lon);
      
    } catch (error) {
      console.error("Location error:", error);
      toast.showToast("Could not fetch GPS", "error");
    } finally {
      setLocationLoading(false);
    }
  };

  // Get place name for coordinates
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

  // Handle location selected from LocationPickerModal
  const handleLocationSelected = (locationData) => {
    if (!locationData) return;
    
    setManualLatLng({
      latitude: locationData.latitude,
      longitude: locationData.longitude,
    });
    
    const coords = `${locationData.latitude.toFixed(4)}, ${locationData.longitude.toFixed(4)}`;
    setLocation(coords);
    
    // Use place name from location data if available
    if (locationData.placeName) {
      setPlaceName(locationData.placeName);
    } else {
      // Get place name via reverse geocoding
      getPlaceNameForCoordinates(locationData.latitude, locationData.longitude);
    }
    
    setSelectedLocationData(locationData);
    setPickerVisible(false);
    toast.showToast("Location selected!", "success");
  };

  const handleSubmit = async () => {
    if (!location || !incidentType) {
      toast.showToast("Fill all required fields", "error");
      return;
    }
    
    // Check if location is in Karnataka
    if (selectedLocationData && !selectedLocationData.isInKarnataka) {
      toast.showToast("Location must be in Karnataka", "error");
      return;
    }
    
    // Ask user if they want to login or submit anonymously
    if (!user) {
      Alert.alert(
        "Submit Report",
        "Submit anonymously or login to track your reports:",
        [
          { 
            text: "Submit Anonymously", 
            style: "default",
            onPress: () => submitReport(null) 
          },
          { 
            text: "Login First", 
            style: "cancel",
            onPress: () => navigation.navigate("Auth") 
          }
        ]
      );
      return;
    }
    
    // User is logged in, submit with user_id
    await submitReport(user.id);
  };

  const submitReport = async (userId) => {
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
        user_id: userId, // null for anonymous, user.id for logged in
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
        // Clear form
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

  // Re-center to current location
  const reCenterToCurrentLocation = () => {
    if (manualLatLng) {
      // Center map on current location
      // This would need to be implemented in LocationPickerModal
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
            {/* USER STATUS BADGE */}
            <View style={styles.userStatusContainer}>
              {user ? (
                <View style={styles.loggedInBadge}>
                  <Ionicons name="person-circle" size={18} color="#4CAF50" />
                  <Text style={styles.loggedInText}>
                    Logged in as: {user.fullname || user.email_id}
                  </Text>
                </View>
              ) : (
                <View style={styles.anonymousBadge}>
                  <Ionicons name="person-outline" size={18} color="#666" />
                  <Text style={styles.anonymousText}>
                    Reporting anonymously • 
                    <Text 
                      style={styles.loginLink}
                      onPress={() => navigation.navigate("Auth")}
                    >
                      {" Login to track reports"}
                    </Text>
                  </Text>
                </View>
              )}
            </View>

            {/* LOCATION SECTION */}
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

                <TouchableOpacity
                  style={styles.locationBtn}
                  onPress={handlePickLocation}
                  disabled={locationLoading}
                >
                  {locationLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="map" size={20} color="#fff" />
                      <Text style={styles.locationBtnText}>Select Location</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* INCIDENT TYPE */}
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
                  <Picker.Item label="Accident" value="accident" />
                  <Picker.Item label="Other" value="other" />
                </Picker>
              </View>
            </View>

            {/* DESCRIPTION */}
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

            {/* SUBMIT */}
            <View style={styles.submitSection}>
              <TouchableOpacity
                style={[
                  styles.submitButton,
                  (!incidentType || !location || loading) && styles.submitButtonDisabled,
                ]}
                onPress={handleSubmit}
                disabled={!incidentType || !location || loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="shield-checkmark" size={22} color="#fff" />
                    <Text style={styles.submitButtonText}>
                      {user ? "Submit Report" : "Submit Anonymously"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              
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
  anonymousBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 12,
    borderRadius: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  anonymousText: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  loginLink: {
    color: '#8B133E',
    fontWeight: '600',
    textDecorationLine: 'underline',
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
  locationBtn: {
    backgroundColor: "#29011b",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    opacity: 1,
  },
  locationBtnDisabled: {
    opacity: 0.6,
  },
  locationBtnText: { 
    color: "#fff", 
    fontSize: 16, 
    fontWeight: "600" 
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
  submitButton: {
    backgroundColor: "#570a1c",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    width: '100%',
  },
  submitButtonDisabled: {
    backgroundColor: "#ccc",
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  disclaimer: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 12,
    fontStyle: 'italic',
  },
});