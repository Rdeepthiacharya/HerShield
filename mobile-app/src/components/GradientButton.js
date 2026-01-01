import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

export default function GradientButton({
  text,
  onPress,
  loading = false,
  disabled = false,
  icon = null,
  variant = "dark",
}) {
  const isLight = variant === "light";
  const colors = isLight ? ["#fff", "#f8d8e5"] : ["#9B1553", "#4A0D35"];
  const textColor = isLight ? "#9B1553" : "#fff";

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.button, (disabled || loading) && { opacity: 0.6 }]}
    >
      <LinearGradient colors={colors} style={styles.gradient}>
        {loading ? (
          <ActivityIndicator size="small" color={textColor} />
        ) : (
          <View style={styles.row}>
            {icon}
            <Text style={[styles.text, { color: textColor }]}>{text}</Text>
          </View>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 15,
    overflow: "hidden",
    marginVertical: 8,
  },
  gradient: {
    paddingVertical: 14,
    paddingHorizontal: 30, 
    borderRadius: 15,
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  text: {
    fontWeight: "bold",
    fontSize: 16,
  },
});
