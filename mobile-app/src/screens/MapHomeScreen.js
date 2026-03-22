import React, { useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from "react-native";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";

import AppHeader from "../components/AppHeader";
import BottomNav from "../components/BottomNav";
import WebMapComponent from "../components/WebMapComponent";
import MapFloatingControls from "../components/MapFloatingControls";

import { useToast } from "../context/ToastContext";
import { BASE_URL } from "../utils/config";

export default function MapHomeScreen({ navigation }) {
  const mapRef = useRef(null);
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [start, setStart] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [incidentsCount, setIncidentsCount] = useState(0);

  useEffect(() => {
    requestLocation();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") fetchIncidents();
    });
    return () => sub.remove();
  }, []);


  const requestLocation = async () => {
    try {
      setLoading(true);

      let { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        const res = await Location.requestForegroundPermissionsAsync();
        status = res.status;
      }

      if (status !== "granted") {
        showToast("Location permission required", "warning");
        Linking.openSettings();
        fallbackLocation();
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coord = {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      };

      setUserLocation(coord);
      setStart(coord);

      if (mapReady) {
        mapRef.current?.showCurrentLocation(coord.lat, coord.lng);
        mapRef.current?.setStart(coord.lat, coord.lng);
      }
    } catch {
      fallbackLocation();
    } finally {
      setLoading(false);
    }
  };

  const fallbackLocation = () => {
    const coord = { lat: 12.9716, lng: 77.5946 };
    setUserLocation(coord);
    setStart(coord);

    if (mapReady) {
      mapRef.current?.showCurrentLocation(coord.lat, coord.lng);
      mapRef.current?.setStart(coord.lat, coord.lng);
    }
  };



  useEffect(() => {
    if (!mapReady) return;
    fetchIncidents();
    const id = setInterval(fetchIncidents, 120000);
    return () => clearInterval(id);
  }, [mapReady]);


  useEffect(() => {
    if (!mapReady || !userLocation) return;

    mapRef.current?.showCurrentLocation(
      userLocation.lat,
      userLocation.lng
    );
    mapRef.current?.setStart(
      userLocation.lat,
      userLocation.lng
    );
  }, [mapReady, userLocation]);


  const fetchIncidents = async () => {
    try {
      const res = await fetch(`${BASE_URL}/incidents/recent`);
      const data = await res.json(); // ← data exists ONLY below this line
  
      if (data?.success && Array.isArray(data.incidents)) {
        const normalized = data.incidents.map(i => ({
          latitude: i.latitude ?? i.lat,
          longitude: i.longitude ?? i.lng,
          severity: i.severity ?? 1,
          incident_type: i.incident_type,
          description: i.description,
          place_name: i.place_name,
        }));
  
        setIncidents(normalized);
        setIncidentsCount(normalized.length);
  
        if (mapReady) {
          mapRef.current?.addIncidents(normalized);
        }
      } else {
        setIncidents([]);
        setIncidentsCount(0);
      }
    } catch (e) {
      console.log("Incident fetch error", e);
    }
  };
  

  const onMapMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);

      if (msg.type === "MAP_READY") {
        setMapReady(true);

        if (userLocation) {
          mapRef.current?.showCurrentLocation(
            userLocation.lat,
            userLocation.lng
          );
          mapRef.current?.setStart(userLocation.lat, userLocation.lng);
        }

        fetchIncidents();
      }


      if (msg.type === "mapClick") {
      }
    } catch (e) {
      console.log("Map message error", e);
    }
  };


  return (
    <>
      <AppHeader title="HerShield" />
      <>
        <View style={{ flex: 1 }}>
          <WebMapComponent ref={mapRef} onMapMessage={onMapMessage} />
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <MapFloatingControls
              onLocate={() => {
                if (!mapReady) return;
                requestLocation();
              }}
              onReset={() => {
                if (!mapReady) return;
                mapRef.current?.resetToKarnataka();
              }}
              onSearch={() =>
                navigation.navigate("Search", { startPoint: start })
              }
              onIncidents={() => null}
              incidentCount={incidentsCount}
            />

          </View>
          {loading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#8B133E" />
            </View>
          )}
        </View>
      </>
      <BottomNav active="Map" navigation={navigation} />
    </>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
});