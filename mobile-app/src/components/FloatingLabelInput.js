import React, { useState, useEffect } from "react";
import { View, Text, TextInput, Animated, StyleSheet } from "react-native";

export default function FloatingLabelInput({
  label,
  value,
  onChangeText,
  keyboardType = "default",
  secureTextEntry = false,
  editable = true,
  borderColor = "rgba(0,0,0,0.2)",
  error = "",
}) {
  const [isFocused, setIsFocused] = useState(false);
  const animatedLabel = new Animated.Value(value ? 1 : 0);

  useEffect(() => {
    Animated.timing(animatedLabel, {
      toValue: isFocused || value ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [isFocused, value]);

  const labelStyle = {
    position: "absolute",
    left: 10,
    top: animatedLabel.interpolate({
      inputRange: [0, 1],
      outputRange: [18, -8],
    }),
    fontSize: animatedLabel.interpolate({
      inputRange: [0, 1],
      outputRange: [16, 12],
    }),
    color: "#8B133E",
    backgroundColor: "white",
    paddingHorizontal: 4,
  };

  return (
    <View style={{ marginBottom: 18 }}>
      <View style={[styles.inputContainer, { borderColor }]}>
        <Animated.Text style={labelStyle}>{label}</Animated.Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          style={styles.input}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          editable={editable}
        />
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inputContainer: {
    borderWidth: 1.3,
    borderRadius: 10,
    paddingTop: 12,
    paddingBottom: 6,
    paddingHorizontal: 10,
    backgroundColor: "#fff",
  },
  input: {
    fontSize: 16,
    color: "#000",
    marginTop: 6,
  },
  errorText: {
    marginTop: 4,
    color: "#C62828",
    fontSize: 12,
  },
});
