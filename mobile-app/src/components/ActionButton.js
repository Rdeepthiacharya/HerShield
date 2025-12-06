import { TouchableOpacity, Text, StyleSheet } from "react-native";
import { Ionicons, MaterialIcons, FontAwesome5 } from "@expo/vector-icons";

export default function ActionButton({
  icon,
  iconSet = "ionicons",
  label,
  onPress,
  active = false,
}) {
  const color = active ? "#fff" : "#4A0D35";

  const renderIcon = () => {
    switch (iconSet) {
      case "material":
        return <MaterialIcons name={icon} size={26} color={color} />;
      case "fontawesome5":
        return <FontAwesome5 name={icon} size={24} color={color} />;
      default:
        return <Ionicons name={icon} size={26} color={color} />;
    }
  };

  return (
    <TouchableOpacity
      style={[styles.actionBtn, active && styles.actionActive]}
      onPress={onPress}
    >
      {renderIcon()}
      <Text style={[styles.label, active && { color: "#fff" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  actionBtn: {
    backgroundColor: "#e8d1e0ff",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    width: 140,
    elevation: 3,
    marginHorizontal: 10,
  },
  actionActive: { backgroundColor: "#8B133E" },
  label: { color: "#333", marginTop: 6, fontWeight: "600" },
});
