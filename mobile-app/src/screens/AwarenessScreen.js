import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Linking,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { MaterialIcons, FontAwesome5, Ionicons } from "@expo/vector-icons";

import AppHeader from "../components/AppHeader";
import PageWrapper from "../components/PageWrapper";
import BottomNav from "../components/BottomNav";
import YouTubePlayer from "../components/YouTubePlayer";

export default function AwarenessScreen({ navigation }) {

  const helplines = [
    { name: "Women Helpline", number: "1091", icon: "venus" },
    { name: "Police Helpline", number: "100", icon: "phone" },
    { name: "National Emergency", number: "112", icon: "exclamation-triangle" },
    { name: "Domestic Violence", number: "181", icon: "home" },
  ];

  const safetyTips = [
    "Always share your live location with a trusted contact when traveling alone.",
    "Avoid isolated areas at night; choose well-lit routes.",
    "Keep emergency numbers saved in your phone.",
    "Be aware of your surroundings — avoid distractions like loud music in headphones.",
    "Use HerShield’s SOS feature when you feel unsafe.",
  ];

  const videos = [
    { id: 1, title: "Self Defense Basics", url: "https://youtu.be/M4_8PoRQP8w?si=koA5hC6ROcTFe2eG" },
  ];

  const extractVideoId = (url) => {
    if (!url) return null;
    if (url.includes("youtu.be/")) return url.split("youtu.be/")[1].split("?")[0];
    if (url.includes("v=")) return url.split("v=")[1].split("&")[0];
    return null;
  };

  const openHelpline = (num) => Linking.openURL(`tel:${num}`);

  return (
    <>
      <AppHeader title="HerShield" />
      <PageWrapper>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Emergency Helplines</Text>

            {helplines.map((item, index) => (
              <TouchableOpacity key={index} style={styles.helplineCard} onPress={() => openHelpline(item.number)}>
                <View style={styles.iconBox}>
                  <FontAwesome5 name={item.icon} size={20} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.helplineName}>{item.name}</Text>
                  <Text style={styles.helplineNumber}>{item.number}</Text>
                </View>
                <Ionicons name="call-outline" size={22} color="#4A0D35" />
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Safety Tips</Text>

            {safetyTips.map((tip, index) => (
              <View key={index} style={styles.tipCard}>
                <MaterialIcons name="lightbulb-outline" size={22} color="#8B133E" />
                <Text style={styles.tipText}>{tip}</Text>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Awareness Videos</Text>
            {videos.map((v) => (
              <View key={v.id} style={styles.videoCard}>
                <Text style={styles.videoTitle}>{v.title}</Text>
                <YouTubePlayer videoId={extractVideoId(v.url)} />
              </View>
            ))}
          </View>
        </ScrollView>
      </PageWrapper>

      <BottomNav active="Awareness" navigation={navigation} />
    </>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 25,  paddingHorizontal: 20 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#4A0D35",
    marginBottom: 10,
  },
  helplineCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8f8f8",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    elevation: 2,
  },
  iconBox: {
    backgroundColor: "#8B133E",
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  helplineName: { fontSize: 15, fontWeight: "600", color: "#222" },
  helplineNumber: { fontSize: 13, color: "#8B133E" },
  tipCard: {
    flexDirection: "row",
    backgroundColor: "#e1d8d8ff",
    padding: 10,
    borderRadius: 10,
    marginBottom: 8,
    gap: 8,
  },
  tipText: { flex: 1, color: "#333", fontSize: 14, lineHeight: 20 },
  videoCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    marginBottom: 20,
    elevation: 3,
  },
  videoTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#4A0D35",
    marginBottom: 10,
  },
});
