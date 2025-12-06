// src/navigation/MapStack.js
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import MapHomeScreen from "../screens/MapHomeScreen";
import SearchScreen from "../screens/SearchScreen";
import RouteDetailsScreen from "../screens/RouteDetailsScreen";
import NavigationScreen from "../screens/NavigationScreen";


const Stack = createNativeStackNavigator();

export default function MapStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="MapHome" component={MapHomeScreen} />
      <Stack.Screen 
        name="Search" 
        component={SearchScreen} 
        options={{
          presentation: "modal",
          animation: "slide_from_bottom",
        }}
      />
      <Stack.Screen 
        name="RouteDetails" 
        component={RouteDetailsScreen} 
        options={{
          animation: "slide_from_right",
        }}
      />
      <Stack.Screen 
        name="Navigation" 
        component={NavigationScreen} 
        options={{
          gestureEnabled: false,
          animation: "fade",
        }}
      />
    </Stack.Navigator>
  );
}