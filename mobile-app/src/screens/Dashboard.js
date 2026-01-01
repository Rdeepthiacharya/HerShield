import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
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

  const [stats, setStats] = useState({
    reportsFiled: 0,
    sosUsed: 0,
  });

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const storedUser = await AsyncStorage.getItem("user");
        if (storedUser) {
          const parsedUser = JSON.parse(storedUser);
          setUserName(parsedUser.fullname);

          // Fetch trusted contacts
          const contactsRes = await fetch(
            `${BASE_URL}/trusted-contacts/${parsedUser.id}`
          );
          const contactsData = await contactsRes.json();

          if (Array.isArray(contactsData.contacts)) {
            setContactsPreview(contactsData.contacts);
          }

          // Fetch user statistics
          console.log("Fetching stats for user ID:", parsedUser.id);
          const statsRes = await fetch(
            `${BASE_URL}/user-stats/${parsedUser.id}`
          );
          console.log("Stats response status:", statsRes.status);
          const statsData = await statsRes.json();
          console.log("Stats data received:", statsData);

          if (statsData.success && statsData.stats) {
            setStats({
              reportsFiled: statsData.stats.reports_filed,
              sosUsed: statsData.stats.sos_used,
            });
            console.log("Stats updated:", statsData.stats);
          } else {
            console.log("Stats fetch failed or no data:", statsData);
          }
        }

      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setTimeout(() => setLoading(false), 300);
      }
    };

    fetchUserData();
  }, []);

  const handleActivateSOS = () => {
    navigation.navigate("SOS");
  };

  return (
    <>
      <AppHeader title="HerShield"
      // logoSource={require("../assets/icon/app-favicon.png")}
      />

      <PageWrapper loading={loading}>
        <View style={styles.container}>
          <ScreenHeader title={<Text>Welcome back, {"\n"} {userName || "User"}</Text>} />

          {/* SOS */}
          <View style={styles.centerArea}>
            <TouchableOpacity
              style={styles.sosButton}
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
              <Text style={styles.statLabelSmall}>Reports Filed</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{stats.sosUsed}</Text>
              <Text style={styles.statLabelSmall}>SOS Used</Text>
            </View>
          </View>

          {/* Trusted Contacts */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Trusted Contacts</Text>
              <TouchableOpacity onPress={() => navigation.navigate("Profile")}>
                <Text style={styles.viewAll}>Manage</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.contactsPreview}>
              {contactsPreview.length === 0 ? (
                <Text style={styles.emptyText}>No contacts yet</Text>
              ) : (
                contactsPreview.map((c, i) => (
                  <View key={i} style={styles.contactPreviewItem}>
                    <View style={styles.contactAvatar}>
                      <Text style={styles.contactAvatarText}>
                        {c.contact_name[0].toUpperCase()}
                      </Text>
                    </View>

                    <Text style={styles.contactPreviewText}>
                      {c.contact_name}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </View>

          <View style={[styles.section, { marginBottom: 40 }]}>
            <Text style={styles.sectionTitle}>Safety Tip of the Day</Text>
            <View style={styles.tipCard}>
              <MaterialCommunityIcons
                name="lightbulb-on-outline"
                size={20}
                color="#ffd54f"
              />
              <Text style={styles.tipText}>
                Walk in well-lit areas at night and share your live location
                with a trusted contact.
              </Text>
            </View>
          </View>
        </View>
      </PageWrapper>

      <BottomNav active="Dashboard" navigation={navigation} />
    </>
  );
}

const styles = StyleSheet.create({

  container: { paddingHorizontal: 20 },
  /* SOS */
  centerArea: { alignItems: "center" },
  sosButton: { alignSelf: "center" },
  sosGradient: {
    width: 180,
    height: 180,
    borderRadius: 90,
    alignItems: "center",
    justifyContent: "center",
    elevation: 10,
  },
  sosText: { color: "#fff", fontSize: 18, fontWeight: "700", marginTop: 8 },

  /* Stats */
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#fafafa",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginHorizontal: 6,
    alignItems: "center",
  },
  statNumber: { fontSize: 20, fontWeight: "800", color: "#8B133E" },
  statLabelSmall: { color: "#666", fontSize: 12, marginTop: 6 },

  /* Sections */
  section: { marginTop: 22 },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#4A0D35" },
  viewAll: { color: "#8B133E", fontWeight: "700" },

  /* Contacts */
  contactsPreview: { marginTop: 8 },
  contactPreviewItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  contactAvatar: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#f1e8ea",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  contactAvatarText: { color: "#8B133E", fontWeight: "700" },
  contactPreviewText: { color: "#333" },

  /* Tip */
  tipCard: {
    marginTop: 8,
    backgroundColor: "#fff8e6",
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  tipText: { color: "#5c4b2a", flex: 1 },

  emptyText: { color: "#999", textAlign: "center" },
});