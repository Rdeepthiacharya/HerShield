import { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import PageWrapper from "../components/PageWrapper";
import GradientButton from "../components/GradientButton";

export default function WelcomeScreen({ navigation }) {
  const ripple = useRef(new Animated.Value(0)).current;
  const logoFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(ripple, {
          toValue: 1,
          duration: 1800,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ripple, {
          toValue: 0,
          duration: 50,
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.timing(logoFade, {
      toValue: 1,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);

  const rippleScale = ripple.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 2.1],
  });

  const rippleOpacity = ripple.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0.45, 0.12, 0],
  });

  return (
    <LinearGradient colors={["#4A0D35", "#8B133E"]} style={{ flex: 1 }}>
      <PageWrapper>
        <View style={styles.container}>
          <View style={styles.heroCentered}>
            <Animated.View
              style={[
                styles.ripple,
                {
                  transform: [{ scale: rippleScale }],
                  opacity: rippleOpacity,
                },
              ]}
            />

            <Animated.View
              style={[
                styles.ripple,
                {
                  transform: [
                    {
                      scale: rippleScale.interpolate({
                        inputRange: [0.6, 2.1],
                        outputRange: [0.4, 1.4],
                      }),
                    },
                  ],
                  opacity: rippleOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.2, 0],
                  }),
                },
              ]}
            />

            <Animated.Image
              source={require("../../assets/icon/app-favicon.png")}
              style={[styles.logo, { opacity: logoFade }]}
              resizeMode="contain"
            />
          </View>

          <Text style={styles.title}>HerShield</Text>
          <Text style={styles.subtitle}>Together, We Redefine Safety</Text>

          <View style={styles.buttons}>
            <GradientButton
              text="LOGIN" variant="light"
              onPress={() => navigation.navigate("Auth", { mode: "login" })}
            />
            <GradientButton
              text="SIGN UP" variant="light"
              onPress={() => navigation.navigate("Auth", { mode: "signup" })}
            />
          </View>
        </View>
      </PageWrapper>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingTop: Platform.OS === "android" ? 40 : 60,
  },

  heroCentered: {
    width: 260,
    height: 260,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },

  ripple: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 220,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.25)",
  },

  logo: {
    width: 180,
    height: 180,
    borderRadius: 100,
    borderWidth: 4,
    borderColor: "#fff",
  },

  title: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "800",
    marginTop: 10,
  },

  subtitle: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    marginTop: 6,
    marginBottom: 20,
  },

  buttons: {
    width: "100%",
    gap: 15,
    marginTop: 15,
  },
});