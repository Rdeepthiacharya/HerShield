import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function Toast({
  message,
  type = "info",
  duration = 3000,
  onDismiss,
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(100)).current;

  useEffect(() => {
    // 1. Animate In
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(slideUp, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    // 2. Animate Out after duration
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideUp, {
          toValue: 100,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        onDismiss?.();
      });
    }, duration);

    return () => clearTimeout(timer);
  }, [duration]);

  // --- Logic for Colors ---
  const isSuccess = type === "success";
  const successColor = "#059669"; // Green
  const errorColor = "#DC2626"; // Red

  const borderLeftColor = isSuccess ? successColor : errorColor;
  const iconColor = isSuccess ? successColor : errorColor;
  const icon = isSuccess ? "checkmark-circle" : "close-circle";

  return (
    <Animated.View
      style={[
        styles.container,
        { opacity, transform: [{ translateY: slideUp }] },
      ]}
    >
      <View style={[styles.toast, { borderLeftColor: borderLeftColor }]}>
        <Ionicons name={icon} size={24} color={iconColor} />
        <Text style={styles.message}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    // FIX 1: Move it down (avoid logo)
    top: 100,
    left: 0,
    right: 0,
    // FIX 2: Align to the right side
    alignItems: "flex-end",
    zIndex: 9999,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    // FIX 3: Add right margin so it's not sticking to the edge
    marginRight: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    // Border styling
    borderLeftWidth: 5,
    // Shadow for depth
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    minWidth: 200,
    maxWidth: "80%",
    gap: 12,
  },
  message: {
    color: "#1F2937",
    fontWeight: "600",
    fontSize: 14,
    flexShrink: 1,
  },
});
