import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Vibration,
  PermissionsAndroid,
  Platform,
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

export default function SOSScreen({ navigation }) {
  const toast = useToast();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [timerActive, setTimerActive] = useState(false);
  const intervalRef = useRef(null);

  // ------------------ Load user ------------------
  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem("user");
      if (stored) setUser(JSON.parse(stored));
    })();
  }, []);

  // ------------------ Permission Request ------------------
  // const requestMicPermission = async () => {
  //   if (Platform.OS !== "android") return true;

  //   try {
  //     const granted = await PermissionsAndroid.request(
  //       PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  //       {
  //         title: "HerShield Microphone Permission",
  //         message:
  //           "HerShield needs microphone access to listen for emergency wake words.",
  //         buttonPositive: "OK",
  //       }
  //     );
  //     return granted === PermissionsAndroid.RESULTS.GRANTED;
  //   } catch (err) {
  //     console.warn("Permission error:", err);
  //     return false;
  //   }
  // };

  // Voice monitoring disabled - wake word functionality removed

  // ------------------ Manual or Auto SOS Trigger ------------------
  const triggerSOS = async (auto = false) => {
    if (!user?.id) return toast.showToast("User missing", "error");

    setLoading(true);
    Vibration.vibrate(300);

    let lat = null,
      lon = null;

    try {
      const loc = await Location.getCurrentPositionAsync({});
      lat = loc.coords.latitude;
      lon = loc.coords.longitude;
    } catch (e) {
      console.log("Location error:", e);
    }

    const res = await fetch(`${BASE_URL}/send_sos_sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: user.id, lat, lon, auto }),
    });

    const data = await res.json();

    if (!data.success) {
      toast.showToast("SOS failed", "error");
    } else {
      toast.showToast("SOS Sent!", "success");
    }

    setLoading(false);
  };

  // ------------------ Countdown Logic ------------------
  const startCountdown = () => {
    let time = 5;
    setCountdown(time);
    setTimerActive(true);

    intervalRef.current = setInterval(() => {
      time--;
      setCountdown(time);

      if (time <= 0) {
        clearInterval(intervalRef.current);
        triggerSOS();
        setTimerActive(false);
        setCountdown(null);
      }
    }, 1000);
  };

  const cancelSOS = () => {
    clearInterval(intervalRef.current);
    setTimerActive(false);
    setCountdown(null);
    toast.showToast("SOS Cancelled", "info");
  };

  // ------------------ UI ------------------
  return (
    <>
      <AppHeader title="HerShield" />
      <PageWrapper loading={loading}>
        <ScreenHeader
          title="Emergency SOS"
          subtitle={
            <Text>
              Tap to send alert — 5 seconds to cancel. {"\n"}
              {/* Speak 'Help me now' to activate through voice monitor */}
            </Text>
          }
        />

        <TouchableOpacity
          onPress={timerActive ? cancelSOS : startCountdown}
          disabled={loading}
        >
          <LinearGradient
            colors={["#4A0D35", "#8B133E"]}
            style={styles.sosButton}
          >
            <Ionicons name="alert" size={56} color="#fff" />
            <Text style={styles.sosText}>
              {timerActive ? `Cancel (${countdown})` : "ACTIVATE SOS"}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* <View style={styles.actions}>
          <ActionButton
            icon="mic-off"
            label="Voice Monitor"
            active={false}
            onPress={() => {
              toast.showToast("Voice monitoring temporarily disabled", "info");
            }}
          />
        </View> */}
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
  actions: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    marginTop: 40,
  },
});