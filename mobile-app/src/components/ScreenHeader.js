import { View, Text, StyleSheet } from "react-native";

export default function ScreenHeader({ title, subtitle }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    marginVertical: 40,
    justifyContent: "center",
    marginTop: 20,
    paddingvertical: 20,
  },
  title: { fontSize: 21, fontWeight: "700", color: "#111" ,textAlign: "center",},
  subtitle: {
    fontSize: 14,
    color: "#555",
    marginTop: 4,
    textAlign: "center",
    paddingHorizontal: 30,
  },
});
