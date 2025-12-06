import { View, StyleSheet } from "react-native";
import YoutubeIframe from "react-native-youtube-iframe";

export default function YouTubePlayer({ videoId }) {
  if (!videoId) return null;

  return (
    <View style={styles.container}>
      <YoutubeIframe height={220} videoId={videoId} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
  },
});
