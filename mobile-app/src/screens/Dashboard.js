import { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AppHeader from "../components/AppHeader";
import BottomNav from "../components/BottomNav";
import PageWrapper from "../components/PageWrapper";
import ScreenHeader from "../components/ScreenHeader";
import { BASE_URL } from "../utils/config";

export default function Dashboard({ navigation }) {
  const [userName, setUserName] = useState("");
  const [loading, setLoading] = useState(true);
  const [contactsPreview, setContactsPreview] = useState([]);

  const [showLiveTrackingDot, setShowLiveTrackingDot] = useState(false);

  const refreshLiveTrackingIndicator = useCallback(async () => {
    try {
      let navActive = false;
      const stored = await AsyncStorage.getItem("active_tracking_session");
      if (stored) {
        const session = JSON.parse(stored);
        if (session.expires_at) {
          const now = Date.now();
          const expiry = new Date(session.expires_at).getTime();
          if (now >= expiry) {
            await AsyncStorage.removeItem("active_tracking_session");
          } else {
            navActive = true;
          }
        } else {
          navActive = true;
        }
      }

      await AsyncStorage.setItem("isSharing", navActive ? "true" : "false");

      let sosActive = false;
      const emergency = await AsyncStorage.getItem("emergency_tracking_session");
      if (emergency) {
        try {
          JSON.parse(emergency);
          sosActive = true;
        } catch {
          sosActive = false;
        }
      }

      setShowLiveTrackingDot(navActive || sosActive);
    } catch {
      setShowLiveTrackingDot(false);
    }
  }, []);

  const [stats, setStats] = useState({
    reportsFiled: 0,
    sosUsed: 0,
  });

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning ☀️";
    if (hour < 18) return "Good afternoon 🌤️";
    return "Good evening 🌙";
  };

  // Context banner
  const getSafetyMessage = () => {
    const hour = new Date().getHours();
    if (hour >= 21 || hour <= 5) {
      return "You're out late. Consider sharing your live location.";
    }
    return "Stay aware and keep emergency contacts ready.";
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const storedUser = await AsyncStorage.getItem("user");
        await refreshLiveTrackingIndicator();

        if (storedUser) {
          const parsedUser = JSON.parse(storedUser);
          setUserName(parsedUser.fullname);

          // contacts
          const contactsRes = await fetch(
            `${BASE_URL}/trusted-contacts/${parsedUser.id}`
          );
          const contactsData = await contactsRes.json();

          if (Array.isArray(contactsData.contacts)) {
            setContactsPreview(contactsData.contacts);
          }

          // stats
          const statsRes = await fetch(
            `${BASE_URL}/user-stats/${parsedUser.id}`
          );
          const statsData = await statsRes.json();

          if (statsData.success) {
            setStats({
              reportsFiled: statsData.stats.reports_filed,
              sosUsed: statsData.stats.sos_used,
            });
          }
        }

      } catch (err) {
        console.log("Dashboard error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [refreshLiveTrackingIndicator]);

  useFocusEffect(
    useCallback(() => {
      refreshLiveTrackingIndicator();
    }, [refreshLiveTrackingIndicator])
  );

  useEffect(() => {
    if (!showLiveTrackingDot) return;
    const id = setInterval(() => {
      refreshLiveTrackingIndicator();
    }, 5000);
    return () => clearInterval(id);
  }, [showLiveTrackingDot, refreshLiveTrackingIndicator]);

  const handleActivateSOS = () => {
    navigation.navigate("SOS");
  };

  return (
    <>
      <AppHeader title="HerShield" />

      <PageWrapper loading={loading}>
        <View style={styles.container}>

          <View style={styles.headerWithDot}>
            <ScreenHeader
              title={
                <Text>
                  {getGreeting()}
                  {"\n"}
                  {userName || "User"}
                </Text>
              }
            />
            {showLiveTrackingDot ? (
              <View
                style={styles.liveDot}
                accessible
                accessibilityLabel="Live location or SOS tracking is active"
              />
            ) : null}
          </View>

          {/* Context Banner */}
          <View style={styles.alertBanner}>
            <MaterialCommunityIcons name="shield-alert" size={18} color="#fff" />
            <Text style={styles.alertText}>{getSafetyMessage()}</Text>
          </View>

          {/* SOS */}
          <View style={styles.centerArea}>
            <TouchableOpacity
              onPress={handleActivateSOS}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={["#4A0D35", "#8B133E"]}
                style={styles.sosGradient}
              >
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={44}
                  color="#fff"
                />
                <Text style={styles.sosText}>Activate SOS</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{stats.reportsFiled}</Text>
              <Text style={styles.statLabel}>Reports</Text>
            </View>

            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{stats.sosUsed}</Text>
              <Text style={styles.statLabel}>SOS Used</Text>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Trusted Contacts</Text>
              <TouchableOpacity onPress={() => navigation.navigate("Profile")}>
                <Text style={styles.viewAll}>Manage</Text>
              </TouchableOpacity>
            </View>

            {contactsPreview.length === 0 ? (
              <Text style={styles.emptyText}>No contacts yet</Text>
            ) : (
              contactsPreview.map((c, i) => (
                <TouchableOpacity key={i} style={styles.contactItem}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {c.contact_name[0].toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.contactName}>
                    {c.contact_name}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>

        </View>
      </PageWrapper>

      <BottomNav active="Dashboard" navigation={navigation} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20 },

  alertBanner: {
    flexDirection: "row",
    backgroundColor: "#8B133E",
    padding: 10,
    borderRadius: 10,
    marginBottom: 15,
    alignItems: "center",
    gap: 8,
  },
  alertText: { color: "#fff", flex: 1 },

  headerWithDot: {
    position: "relative",
    alignSelf: "stretch",
  },
  liveDot: {
    position: "absolute",
    right: 4,
    top: 36,
    width: 20,
    height: 20,
    borderRadius: 15,
    backgroundColor: "#43A047",
    borderWidth: 2,
    borderColor: "#fff",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },

  centerArea: { alignItems: "center" },

  sosGradient: {
    width: 180,
    height: 180,
    borderRadius: 90,
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
  },
  sosText: { color: "#fff", fontSize: 18, fontWeight: "700" },

  statsRow: {
    flexDirection: "row",
    marginTop: 25,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 12,
    marginHorizontal: 6,
    alignItems: "center",
    elevation: 4,
  },
  statNumber: { fontSize: 20, fontWeight: "800", color: "#8B133E" },
  statLabel: { color: "#666", marginTop: 6 },

  section: { marginTop: 30 },

  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  sectionTitle: { fontWeight: "700", color: "#4A0D35" },

  contactItem: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#f1e8ea",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: { color: "#8B133E", fontWeight: "700" },
  contactName: { color: "#333" },

  emptyText: { color: "#999", marginTop: 10 },
});