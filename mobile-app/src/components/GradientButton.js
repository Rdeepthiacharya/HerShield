import { TouchableOpacity, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

export default function GradientButton({ text, onPress, variant = "dark" }) {
  const isLight = variant === "light";
  const colors = isLight ? ["#fff", "#f8d8e5"] : ["#9B1553", "#4A0D35"];
  const textColor = isLight ? "#9B1553" : "#fff";

  return (
    <TouchableOpacity onPress={onPress} style={styles.button}>
      <LinearGradient colors={colors} style={styles.gradient}>
        <Text style={[styles.text, { color: textColor }]}>{text}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 30,
    overflow: "hidden",
    marginVertical: 8,
  },
  gradient: {
    paddingVertical: 14,
    borderRadius: 30,
    alignItems: "center",
  },
  text: { fontWeight: "bold", fontSize: 16, },
});
