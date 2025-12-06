import { View, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Loader from "./Loader";

export default function PageWrapper({
  children,
  loading = false,
  scrollEnabled = true,
  contentContainerStyle,
}) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      {scrollEnabled ? (
        <ScrollView
          contentContainerStyle={[styles.scrollView, contentContainerStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.innerContainer, contentContainerStyle]}>
          {children}
        </View>
      )}

      {loading && <Loader visible={loading} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },

  scrollView: {
    flexGrow: 1,
    paddingBottom: 100, // Space for bottom nav
  },

  innerContainer: {
    flex: 1,
  },
});
