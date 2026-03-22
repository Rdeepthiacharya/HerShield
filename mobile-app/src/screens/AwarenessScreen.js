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
import { Audio } from "expo-av";

import AppHeader from "../components/AppHeader";
import PageWrapper from "../components/PageWrapper";
import BottomNav from "../components/BottomNav";
import YouTubePlayer from "../components/YouTubePlayer";
import { Animated } from "react-native";

export default function AwarenessScreen({ navigation }) {

  const helplines = [
    { name: "Women Helpline", number: "1091", icon: "venus" },
    { name: "Police Helpline", number: "100", icon: "phone" },
    { name: "National Emergency", number: "112", icon: "exclamation-triangle" },
    { name: "Domestic Violence", number: "181", icon: "home" },
  ];


  const safetyTips = [
    "Share your live location with a trusted contact when traveling alone.",
    "Avoid isolated areas at night. Choose well-lit routes.",
    "Keep emergency contacts easily accessible on your phone.",
    "Stay aware of your surroundings. Limit distractions like loud music in headphones.",
    "Use HerShield’s SOS feature whenever you feel unsafe.",
  ];

  const videos = [
    {
      id: 1,
      title: "Self Defense Basics",
      url: "https://youtu.be/M4_8PoRQP8w?si=koA5hC6ROcTFe2eG",
    },
    {
      id: 2,
      title: "Street Self Defense Techniques",
      url: "https://youtu.be/WCn4GBcs84s?si=LsxWgyWitNpxiirW",
    },
    {
      id: 3,
      title: "7 Self-Defense Techniques",
      url: "https://youtu.be/T7aNSRoDCmg?si=D9DbYVHF_-ZvbYFd",
    },
  ];


  const quickGuides = [
    {
      title: "Someone is following you",
      steps: [
        "Move to a crowded/well-lit area",
        "Call someone and speak loudly",
        "Avoid going home directly",
        "Use SOS immediately",
      ],
    },
    {
      title: "Unsafe in a cab",
      steps: [
        "Share live location",
        "Note vehicle number",
        "Pretend you're on a call",
        "Stop in a busy area",
      ],
    },
    {
      title: "Harassment in public",
      steps: [
        "Raise your voice",
        "Move toward people/security",
        "Record if safe",
        "Call 112 or 100",
      ],
    },
  ];

  const [openIndex, setOpenIndex] = React.useState(null);

  const animatedHeights = React.useRef(
    quickGuides.map(() => new Animated.Value(0))
  ).current;

  const selfDefense = [
    {
      title: "Wrist Release",
      desc: "Twist your wrist toward attacker’s thumb and pull away",
    },
    {
      title: "Palm Strike",
      desc: "Strike upward to nose using your palm",
    },
    {
      title: "Knee Attack",
      desc: "Drive knee into groin and escape",
    },
  ];

  const toggleGuide = (index) => {
    const isOpen = openIndex === index;

    animatedHeights.forEach((anim, i) => {
      Animated.timing(anim, {
        toValue: i === index && !isOpen ? 1 : 0,
        duration: 300,
        useNativeDriver: false,
      }).start();
    });

    setOpenIndex(isOpen ? null : index);
  };

  // ---------------- HELPERS ----------------
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
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>

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
            <Text style={styles.sectionTitle}>What To Do If...</Text>

            {quickGuides.map((item, index) => {
              const heightInterpolate = animatedHeights[index].interpolate({
                inputRange: [0, 1],
                outputRange: [0, item.steps.length * 26 + 10],
              });

              return (
                <TouchableOpacity
                  key={index}
                  style={styles.guideCard}
                  onPress={() => toggleGuide(index)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.guideTitle}>{item.title}</Text>

                  <Animated.View style={{ overflow: "hidden", height: heightInterpolate }}>
                    {item.steps.map((step, i) => (
                      <Text key={i} style={styles.guideStep}>• {step}</Text>
                    ))}
                  </Animated.View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Self Defense Basics</Text>

            {selfDefense.map((item, index) => (
              <View key={index} style={styles.defenseCard}>
                <Text style={styles.defenseTitle}>{item.title}</Text>
                <Text style={styles.defenseDesc}>{item.desc}</Text>
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
  section: { marginBottom: 25, paddingHorizontal: 20 },

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

  guideCard: {
    backgroundColor: "#f3e6ea",
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
  },

  guideTitle: {
    fontWeight: "600",
    color: "#4A0D35",
  },

  guideStep: {
    fontSize: 13,
    color: "#333",
    marginBottom: 4,
  },

  defenseCard: {
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
    elevation: 2,
  },

  defenseTitle: {
    fontWeight: "600",
    color: "#8B133E",
  },

  defenseDesc: {
    fontSize: 13,
    color: "#444",
  },

  checkItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },

  checkText: {
    fontSize: 14,
    color: "#333",
  },

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