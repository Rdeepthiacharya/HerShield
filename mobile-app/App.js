import React, { useEffect, useState, useRef } from "react";
import { ActivityIndicator, View, Text } from "react-native";
import { useFonts } from "expo-font";
import { Ionicons, MaterialIcons, Feather } from "@expo/vector-icons";

import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import "react-native-get-random-values";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { ToastProvider } from "./src/context/ToastContext";

import WelcomeScreen from "./src/screens/WelcomeScreen";
import AuthScreen from "./src/screens/AuthScreen";
import Dashboard from "./src/screens/Dashboard";
import ReportScreen from "./src/screens/ReportScreen";
import SOSScreen from "./src/screens/SOSScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import AwarenessScreen from "./src/screens/AwarenessScreen";
import MapStack from './src/navigation/MapStack';

const Stack = createNativeStackNavigator();

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);
  const navigationRef = useRef();

  // Load fonts using useFonts hook - for @expo/vector-icons
  const [fontsLoaded, fontError] = useFonts({
    ...Ionicons.font,
    ...MaterialIcons.font,
    ...Feather.font,
  });

  // Log font loading status
  useEffect(() => {
    if (fontError) {
      console.error("❌ Font loading error:", fontError);
    }
    if (fontsLoaded) {
      console.log("✅ Vector icon fonts loaded successfully");
    }
  }, [fontsLoaded, fontError]);

  // Decide initial navigation screen
  useEffect(() => {
    if (!fontsLoaded) return;

    (async () => {
      try {
        const stored = await AsyncStorage.getItem("user");
        setInitialRoute(stored ? "Dashboard" : "Welcome");
      } catch (error) {
        console.error("AsyncStorage error:", error);
        setInitialRoute("Welcome"); // Default fallback
      }
    })();
  }, [fontsLoaded]);

  // Show loading while fonts load or determining initial route
  if (!fontsLoaded || !initialRoute) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" }}>
        <ActivityIndicator size="large" color="#8B133E" />
        <Text style={{ marginTop: 20, fontSize: 16, color: "#333" }}>
          {!fontsLoaded ? "Loading fonts..." : "Loading HerShield..."}
        </Text>
      </View>
    );
  }

  return (
    <ToastProvider>
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator
          initialRouteName={initialRoute}
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="Auth" component={AuthScreen} />
          <Stack.Screen name="Dashboard" component={Dashboard} />
          <Stack.Screen name="Report" component={ReportScreen} />
          <Stack.Screen name="SOS" component={SOSScreen} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
          <Stack.Screen name="Awareness" component={AwarenessScreen} />
          <Stack.Screen name="Map" component={MapStack} />
        </Stack.Navigator>
      </NavigationContainer>
    </ToastProvider>
  );
}
