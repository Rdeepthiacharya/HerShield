import { useContext } from "react";
import { TouchableOpacity, StyleSheet, View, Text } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { ThemeContext } from "../context/ThemeContext";

export default function ThemeToggle() {
  const { isDarkMode, toggleTheme } = useContext(ThemeContext);

  return (
    <TouchableOpacity onPress={toggleTheme} style={styles.button}>
      <LinearGradient
        colors={isDarkMode ? ["#4A0D35", "#8B133E"] : ["#fff", "#f8f8f8"]}
        style={styles.gradient}
      >
        <View style={styles.row}>
          <Ionicons
            name={isDarkMode ? "moon" : "sunny"}
            size={22}
            color={isDarkMode ? "#fff" : "#4A0D35"}
          />
          <Text style={[styles.text, { color: isDarkMode ? "#fff" : "#4A0D35" }]} >
            {isDarkMode ? "Dark Mode" : "Light Mode"}
          </Text>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "center",
    borderRadius: 30,
    overflow: "hidden",
    marginVertical: 12,
    elevation: 5,
  },
  gradient: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8, },
  text: { fontWeight: "600", fontSize: 16, },
});
