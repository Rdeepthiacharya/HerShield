import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function PasswordInput({
  label,
  value,
  onChangeText,
  error = "",
  secureTextEntry = true,
}) {
  const [show, setShow] = useState(false);

  return (
    <View style={{ marginBottom: 18 }}>
      <View style={styles.inputContainer}>
        <Text style={styles.label}>{label}</Text>

        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!show}
          style={styles.input}
        />

        <TouchableOpacity style={styles.eyeBtn} onPress={() => setShow(!show)}>
          <Ionicons
            name={show ? "eye-off-outline" : "eye-outline"}
            size={20}
            color="#8B133E"
          />
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inputContainer: {
    borderWidth: 1.3,
    borderRadius: 10,
    borderColor: "rgba(0,0,0,0.2)",
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 6,
    backgroundColor: "#fff",
    position: "relative",
  },
  label: {
    position: "absolute",
    top: -10,
    left: 10,
    fontSize: 12,
    backgroundColor: "#fff",
    paddingHorizontal: 4,
    color: "#8B133E",
  },
  input: {
    height: 40,
    fontSize: 16,
    color: "#000",
  },
  eyeBtn: {
    position: "absolute",
    right: 10,
    top: 10,
  },
  errorText: {
    marginTop: 4,
    color: "#C62828",
    fontSize: 12,
  },
});
