import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Vibration,
  Alert,
  Linking,
  Share,
  ScrollView,
} from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useToast } from "../context/ToastContext";

import AppHeader from "../components/AppHeader";
import BottomNav from "../components/BottomNav";
import ScreenHeader from "../components/ScreenHeader";
import ActionButton from "../components/ActionButton";
import PageWrapper from "../components/PageWrapper";

import { BASE_URL } from "../utils/config";
import Clipboard from '@react-native-clipboard/clipboard';

export default function SOSScreen({ navigation }) {
  const toast = useToast();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [timerActive, setTimerActive] = useState(false);
  const [isSharingLiveLocation, setIsSharingLiveLocation] = useState(false);
  const [trackingUrl, setTrackingUrl] = useState("");
  const [currentLocation, setCurrentLocation] = useState(null);


  const intervalRef = useRef(null);
  const locationIntervalRef = useRef(null);


  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem("user");
      if (stored) setUser(JSON.parse(stored));
    })();
  }, []);

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        toast.showToast("Location permission required", "error");
        return null;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const loc = {
        lat: location.coords.latitude,
        lng: location.coords.longitude
      };

      setCurrentLocation(loc);
      return loc;

    } catch (error) {
      console.error("Error getting location:", error);
      return null;
    }
  };

  const createEmergencyTrackingSession = async () => {
    try {
      if (!user?.id) {
        toast.showToast("User not found", "error");
        return null;
      }

      const location = await getCurrentLocation();
      if (!location) {
        toast.showToast("Unable to get location", "error");
        return null;
      }

      const userName = user.fullname || user.name || user.email_id?.split('@')[0] || "User";

      const response = await fetch(`${BASE_URL}/create_tracking_session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          user_name: userName,
          latitude: location.lat,
          longitude: location.lng,
          duration_minutes: 0,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create tracking session");
      }

      const data = await response.json();

      if (data.success) {
        setTrackingUrl(data.tracking_url);
        setIsSharingLiveLocation(true);

        await AsyncStorage.setItem('emergency_tracking_session', JSON.stringify({
          session_id: data.session_id,
          tracking_url: data.tracking_url,
          started_at: new Date().toISOString(),
        }));

        return data;
      }
      return null;
    } catch (error) {
      console.error("Create emergency session error:", error);
      toast.showToast("Failed to create tracking", "error");
      return null;
    }
  };

  const startEmergencyLocationUpdates = async (sessionId) => {
    try {
      if (sessionId && currentLocation) {
        await fetch(`${BASE_URL}/update_location/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: currentLocation.lat,
            longitude: currentLocation.lng,
            timestamp: new Date().toISOString(),
            accuracy: 10,
          }),
        });
      }

      locationIntervalRef.current = setInterval(async () => {
        try {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });

          if (sessionId) {
            await fetch(`${BASE_URL}/update_location/${sessionId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                timestamp: new Date().toISOString(),
                accuracy: 10,
              }),
            });

            setCurrentLocation({
              lat: location.coords.latitude,
              lng: location.coords.longitude
            });
          }
        } catch (error) {
          console.error("Location update error:", error);
        }
      }, 10000);

    } catch (error) {
      console.error("Error starting location updates:", error);
    }
  };

  const generateEmergencyMessage = (trackingUrl) => {
    const userName = user?.fullname || user?.name || user?.email_id?.split('@')[0] || "User";

    if (trackingUrl) {
      return `🚨 ${userName} needs immediate help!

📍 LIVE TRACKING:
${trackingUrl}

• Real-time updates
• Shows exact movement
• Works in any browser

🚨 URGENT - Please check immediately!

Sent via HerShield App`;
    }

    if (currentLocation) {
      const googleMapsLink = `https://maps.google.com/?q=${currentLocation.lat},${currentLocation.lng}`;
      return `⚠️ ${userName} needs help!

📍 Location:
${googleMapsLink}

Please check on them immediately.

Sent via HerShield App`;
    }

    return `⚠️ ${userName} needs help!

📍 Location: Unavailable

Please check on them immediately.

Sent via HerShield App`;
  };

  const sendSOS = async () => {
    try {
      setLoading(true);
      Vibration.vibrate(500);

      const location = await getCurrentLocation();
      if (!location) {
        toast.showToast("Cannot get location", "error");
        setLoading(false);
        return;
      }

      const sessionData = await createEmergencyTrackingSession();

      const response = await fetch(`${BASE_URL}/send_sos_sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          lat: location.lat,
          lon: location.lng,
          auto: false,
          tracking_url: sessionData?.tracking_url || "",
        }),
      });

      const data = await response.json();

      if (data.success) {
        if (sessionData?.tracking_url) {
          toast.showToast("🚨 SOS Sent with Live Tracking!", "success");
          startEmergencyLocationUpdates(sessionData.session_id);
          setTimeout(() => {
            showTrackingOptions(sessionData.tracking_url);
          }, 1000);
        } else {
          toast.showToast("SOS Sent!", "success");
        }
      } else {
        toast.showToast("SOS failed to send", "error");
      }

    } catch (error) {
      console.error("SOS error:", error);
      toast.showToast("SOS failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const showTrackingOptions = (trackingUrl) => {
    const userName = user?.fullname || user?.name || "User";

    Alert.alert(
      "Live Location Active",
      `${userName}'s live location is being tracked. Share this link:`,
      [
        {
          text: "Share via WhatsApp",
          onPress: () => shareViaWhatsApp(trackingUrl)
        },
        {
          text: "Share via Any App",
          onPress: () => shareViaAnyApp(trackingUrl)
        },
        {
          text: "Copy Link",
          onPress: () => {
            Clipboard.setString(trackingUrl);
            toast.showToast("Link copied", "info");
          }
        },
        {
          text: "Test Link",
          onPress: () => {
            Linking.openURL(trackingUrl).catch(() => {
              toast.showToast("Cannot open link", "error");
            });
          }
        },
        {
          text: "OK",
          style: "cancel"
        }
      ]
    );
  };

  const shareViaWhatsApp = async (trackingUrl) => {
    try {
      const message = generateEmergencyMessage(trackingUrl);

      const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;

      const canOpen = await Linking.canOpenURL(whatsappUrl);

      if (canOpen) {
        await Linking.openURL(whatsappUrl);
      } else {
        await Share.share({
          title: "Emergency SOS",
          message: message,
          url: trackingUrl
        });
      }
    } catch (error) {
      console.error("WhatsApp share error:", error);
      toast.showToast("Sharing failed", "error");
    }
  };

  const shareViaAnyApp = async (trackingUrl) => {
    try {
      const message = generateEmergencyMessage(trackingUrl);

      await Share.share({
        title: "Emergency SOS",
        message: message,
        url: trackingUrl
      });
    } catch (error) {
      console.error("Share error:", error);
      toast.showToast("Sharing failed", "error");
    }
  };

  const stopTracking = async () => {
    try {
      const emergencySession = await AsyncStorage.getItem('emergency_tracking_session');
      if (emergencySession) {
        const sessionData = JSON.parse(emergencySession);

        await fetch(`${BASE_URL}/stop_tracking_session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionData.session_id }),
        });
      }
    } catch (error) {
      console.error("Error stopping tracking:", error);
    } finally {
      if (locationIntervalRef.current) {
        clearInterval(locationIntervalRef.current);
      }

      await AsyncStorage.removeItem('emergency_tracking_session');

      setIsSharingLiveLocation(false);
      setTrackingUrl("");

      toast.showToast("Tracking stopped", "success");
    }
  };

  useEffect(() => {
    const checkActiveEmergency = async () => {
      try {
        const activeEmergency = await AsyncStorage.getItem('emergency_tracking_session');
        if (activeEmergency) {
          const sessionData = JSON.parse(activeEmergency);
          setTrackingUrl(sessionData.tracking_url);
          setIsSharingLiveLocation(true);

          Alert.alert(
            "Active Emergency Tracking",
            "You have an active emergency tracking session. Do you want to stop it?",
            [
              {
                text: "Stop Tracking",
                onPress: stopTracking
              },
              {
                text: "Continue",
                style: "cancel"
              }
            ]
          );
        }
      } catch (error) {
        console.error("Check active emergency error:", error);
      }
    };

    checkActiveEmergency();
  }, []);

  const startCountdown = () => {
    let time = 5;
    setCountdown(time);
    setTimerActive(true);

    intervalRef.current = setInterval(() => {
      time--;
      setCountdown(time);

      if (time <= 0) {
        clearInterval(intervalRef.current);
        sendSOS();
        setTimerActive(false);
        setCountdown(null);
      }
    }, 1000);
  };

  const cancelSOS = () => {
    clearInterval(intervalRef.current);
    setTimerActive(false);
    setCountdown(null);
    toast.showToast("SOS Cancelled", "success");
  };

  return (
    <>
      <AppHeader title="HerShield" />
      <PageWrapper loading={loading}>
        <ScrollView>
          <ScreenHeader
            title="Emergency SOS"
            subtitle={
              <Text style={styles.subtitle}>
                {isSharingLiveLocation
                  ? "🚨 LIVE TRACKING ACTIVE - Real-time location sharing"
                  : "Tap SOS button to activate.\n You have 5 seconds to cancel if pressed by mistake."
                }
              </Text>
            }
          />

          <TouchableOpacity
            onPress={timerActive ? cancelSOS : startCountdown}
            disabled={loading}
            style={styles.sosButtonContainer}
          >
            <LinearGradient
              colors={isSharingLiveLocation ? ["#FF0000", "#CC0000"] : ["#4A0D35", "#8B133E"]}
              style={styles.sosButton}
            >
              <Ionicons
                name={isSharingLiveLocation ? "radio-button-on" : "alert"}
                size={56}
                color="#fff"
              />
              <Text style={styles.sosText}>
                {timerActive
                  ? `Cancel (${countdown})`
                  : isSharingLiveLocation
                    ? "TRACKING ACTIVE"
                    : "ACTIVATE SOS"
                }
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {isSharingLiveLocation && trackingUrl && (
            <View style={styles.trackingPanel}>
              <Text style={styles.trackingTitle}>📍 Live Location Active</Text>

              <TouchableOpacity
                style={styles.linkContainer}
                onPress={() => {
                  Clipboard.setString(trackingUrl);
                  toast.showToast("Link copied", "info");
                }}
              >
                <Text style={styles.linkText} numberOfLines={1}>
                  {trackingUrl}
                </Text>
                <Text style={styles.copyHint}>Tap to copy</Text>
              </TouchableOpacity>

              <View style={styles.trackingActions}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => showTrackingOptions(trackingUrl)}
                >
                  <Ionicons name="share-outline" size={20} color="#fff" />
                  <Text style={styles.actionButtonText}>Share Link</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, styles.stopButton]}
                  onPress={stopTracking}
                >
                  <Ionicons name="stop-circle-outline" size={20} color="#fff" />
                  <Text style={styles.actionButtonText}>Stop</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.actions}>
            <ActionButton
              icon="location"
              label="Live Tracking"
              active={isSharingLiveLocation}
              onPress={() => {
                if (isSharingLiveLocation && trackingUrl) {
                  showTrackingOptions(trackingUrl);
                }
              }}
            />
          </View>
        </ScrollView>
      </PageWrapper>

      <BottomNav active="SOS" navigation={navigation} />
    </>
  );
}

const styles = StyleSheet.create({
  sosButton: {
    width: 220,
    height: 220,
    borderRadius: 110,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 20,
    elevation: 8,
  },
  sosText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
    marginTop: 10,
  },
  subtitle: {
    textAlign: "center",
    color: "#666",
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    marginTop: 40,
  },
  trackingPanel: {
    backgroundColor: "#FFEBEE",
    borderColor: "#FF0000",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginTop: 30,
    marginHorizontal: 20,
  },
  trackingTitle: {
    color: "#FF0000",
    fontWeight: "bold",
    fontSize: 14,
    marginBottom: 12,
    textAlign: "center",
  },
  linkContainer: {
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#FFCDD2",
  },
  linkText: {
    color: "#D32F2F",
    fontSize: 12,
    textAlign: "center",
  },
  copyHint: {
    color: "#666",
    fontSize: 10,
    marginTop: 4,
    textAlign: "center",
    fontStyle: "italic",
  },
  trackingActions: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#9B1553",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    minWidth: 100,
    justifyContent: "center",
  },
  stopButton: {
    backgroundColor: "#F44336",
  },
  actionButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
    marginLeft: 6,
  },
  lastDetectionCard: {
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  detectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  detectionText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginLeft: 8,
  },
  detectionTranscript: {
    fontSize: 13,
    color: '#666',
    fontStyle: 'italic',
  },

  sosButtonContainer: {
    alignItems: 'center',
    marginVertical: 10,
  },
  sosButton: {
    width: 220,
    height: 220,
    borderRadius: 110,
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
  },
  sosText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
    marginTop: 10,
  },
  subtitle: {
    textAlign: "center",
    color: "#666",
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    marginTop: 30,
    marginBottom: 20,
  },
  trackingPanel: {
    backgroundColor: "#FFEBEE",
    borderColor: "#FF0000",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 10,
  },
  trackingTitle: {
    color: "#FF0000",
    fontWeight: "bold",
    fontSize: 14,
    marginBottom: 12,
    textAlign: "center",
  },
  linkContainer: {
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#FFCDD2",
  },
  linkText: {
    color: "#D32F2F",
    fontSize: 12,
    textAlign: "center",
  },
  copyHint: {
    color: "#666",
    fontSize: 10,
    marginTop: 4,
    textAlign: "center",
    fontStyle: "italic",
  },
  trackingActions: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#9B1553",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    minWidth: 100,
    justifyContent: "center",
  },
  stopButton: {
    backgroundColor: "#F44336",
  },
  actionButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
    marginLeft: 6,
  },
  infoBox: {
    backgroundColor: "#fdf4f7",
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: '#BBDEFB',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(139, 19, 62, 0.9)',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: 'rgba(139, 19, 62, 0.9)',
    lineHeight: 20,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  modalBody: {
    padding: 20,
    maxHeight: 400,
  },
  detailRow: {
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 15,
    color: '#333',
  },
  reasonsContainer: {
    marginTop: 4,
  },
  reasonText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  modalCloseButton: {
    backgroundColor: '#9B1553',
    margin: 20,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalCloseText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});