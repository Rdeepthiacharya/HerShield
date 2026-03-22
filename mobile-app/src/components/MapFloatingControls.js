import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function MapFloatingControls({
  onLocate,
  onSearch,
  onReset,
  onIncidents,
  incidentCount = 0,
}) {
  const [showIncidentInfo, setShowIncidentInfo] = useState(false);

  const handleIncidentPress = () => {
    if (!showIncidentInfo) {

      setShowIncidentInfo(true);
      setTimeout(() => setShowIncidentInfo(false), 2000);
    } else {

      setShowIncidentInfo(false);
      onIncidents?.();
    }
  };

  return (
    <View pointerEvents="box-none" style={styles.container}>

      {onSearch && (
        <TouchableOpacity style={styles.fab} onPress={onSearch}>
          <Ionicons name="search" size={22} color="#fff" />
        </TouchableOpacity>
      )}

      {onLocate && (
        <TouchableOpacity style={styles.fab} onPress={onLocate}>
          <Ionicons name="locate" size={22} color="#fff" />
        </TouchableOpacity>
      )}

      {onReset && (
        <TouchableOpacity style={styles.fab} onPress={onReset}>
          <Ionicons name="globe-outline" size={22} color="#fff" />
        </TouchableOpacity>
      )}

      {onIncidents && (
        <TouchableOpacity
          style={styles.incidentFab}
          onPress={handleIncidentPress}
          activeOpacity={0.9}
        >
          <Ionicons name="warning" size={22} color="#fff" />

          {incidentCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{incidentCount}</Text>
            </View>
          )}

          {showIncidentInfo && (
             <View style={styles.incidentLabelContainer}>
            <Text
                style={styles.incidentLabel}>
                Incidents nearby
            </Text></View>
            )}

        </TouchableOpacity>
      )}
    </View>
  );
}

const FAB_SIZE = 52;

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 16,
    top: 260,
    alignItems: "center",
    gap: 14,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: "#570a1c",
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  incidentFab: {
    width: FAB_SIZE + 6,
    height: FAB_SIZE + 6,
    borderRadius: (FAB_SIZE + 6) / 2,
    backgroundColor: "#8B133E",
    alignItems: "center",
    justifyContent: "center",
    elevation: 7,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    overflow: "visible",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#FF3B30",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  incidentLabelContainer: {
    position: "absolute",
    top: FAB_SIZE + 8,
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
    elevation: 4,
    alignSelf: "center",
    minWidth: 130,
  },
  incidentLabel: {
    fontSize: 11,
    color: "#8B133E",
    fontWeight: "600",
    textAlign: "center",
    includeFontPadding: false,
    textAlignVertical: "center",
    flexShrink: 0,
  },  
});
