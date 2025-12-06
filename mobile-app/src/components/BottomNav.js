import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function BottomNav({ navigation, active }) {
  const insets = useSafeAreaInsets();

  const tabs = [
    { name: "Dashboard", label: "Home", icon: "home" },
    { name: "SOS", label: "SOS", icon: "alert-triangle" },
    { name: "Report", label: "Report", icon: "file" },
    { name: "Map", label: "Routes", icon: "map-pin" },
    { name: "Awareness", label: "Tips", icon: "zap" },
  ];

  const ACTIVE_COLOR = "#8B133E";
  const INACTIVE_COLOR = "#666";

  return (
    <View
      style={[
        styles.navContainer,
        { paddingBottom: Math.max(insets.bottom, 8) },
      ]}
    >
      <View style={styles.innerBar}>
        {tabs.map((tab) => {
          const isActive = active === tab.name;

          return (
            <TouchableOpacity
              key={tab.name}
              style={[styles.tabButton, isActive && styles.activeTab]}
              onPress={() => navigation.navigate(tab.name)}
              activeOpacity={0.7}
            >
              <Feather
                name={tab.icon}
                size={24}
                color={isActive ? ACTIVE_COLOR : INACTIVE_COLOR}
              />

              <Text
                style={[
                  styles.tabLabel,
                  isActive && { color: ACTIVE_COLOR, fontWeight: "700" },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  navContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#ddd",
    elevation: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    zIndex: 10000, // Very high z-index
  },

  innerBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },

  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },

  activeTab: {
    backgroundColor: "rgba(139, 19, 62, 0.08)",
    borderTopWidth: 3,
    borderTopColor: "#8B133E",
  },

  tabLabel: {
    fontSize: 11,
    marginTop: 3,
    color: "#444",
  },
});