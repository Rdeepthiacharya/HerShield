import React, { useState, useEffect } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  Text,
  StyleSheet,
  Keyboard,
  Alert,
  ActivityIndicator,
  ScrollView
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from 'expo-location';
import AppHeader from "../components/AppHeader";

export default function SearchScreen({ onClose, navigation, route }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [nearbyPlaces, setNearbyPlaces] = useState([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const { startPoint, initialLocation } = route.params || {};

  useEffect(() => {
    getUserLocation();
    if (initialLocation) {
      setQuery(`${initialLocation.lat.toFixed(4)}, ${initialLocation.lng.toFixed(4)}`);
      searchLocation(`${initialLocation.lat}, ${initialLocation.lng}`);
    }
  }, [initialLocation]);

  useEffect(() => {
    if (userLocation) {
      fetchNearbyPlaces();
    }
  }, [userLocation]);

  const getUserLocation = async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      setUserLocation({
        lat: location.coords.latitude,
        lng: location.coords.longitude
      });
    } catch (error) {
      console.log("Location error:", error);
    }
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
  };

  const fetchNearbyPlaces = async () => {
    if (!userLocation) return;

    setPlacesLoading(true);
    try {
      const { lat, lng } = userLocation;

      console.log("Fetching nearby places for location:", lat, lng);

      const bbox = `${lng - 0.045},${lat - 0.045},${lng + 0.045},${lat + 0.045}`;

      const [policeResults, busResults, hospitalResults, metroResults] = await Promise.all([
        fetchPlacesFromOSM("police station", bbox, 'police'),
        fetchBusStopsComprehensive(lat, lng, bbox),
        fetchPlacesFromOSM("hospital", bbox, 'hospital'),
        isInBangaloreArea(lat, lng) ? fetchPlacesFromOSM("metro station", bbox, 'metro') : Promise.resolve([])
      ]);

      console.log("API Results:", {
        police: policeResults.length,
        bus: busResults.length,
        hospital: hospitalResults.length,
        metro: metroResults.length
      });

      let allPlaces = [
        ...policeResults,
        ...busResults,
        ...hospitalResults,
        ...metroResults
      ];

      allPlaces = allPlaces.map(place => ({
        ...place,
        distance: calculateDistance(lat, lng, parseFloat(place.lat), parseFloat(place.lon))
      }));

      const nearbyPlaces = allPlaces
        .filter(place => place.distance <= 5)
        .sort((a, b) => a.distance - b.distance);

      console.log("Nearby places found:", nearbyPlaces.length);

      if (nearbyPlaces.length === 0) {
        console.log("No real places found, showing estimated");
        const estimatedPlaces = getEstimatedPlaces(lat, lng);
        setNearbyPlaces(estimatedPlaces);
      } else {
        setNearbyPlaces(nearbyPlaces);
      }

    } catch (error) {
      console.error("Nearby places error:", error);
      if (userLocation) {
        const estimatedPlaces = getEstimatedPlaces(userLocation.lat, userLocation.lng);
        setNearbyPlaces(estimatedPlaces);
      }
    } finally {
      setPlacesLoading(false);
    }
  };

  const fetchBusStopsComprehensive = async (lat, lng, bbox) => {
    try {
      const searchTerms = [
        "bus stand",
        "bus stop",
        "bus station",
        "bus depot",
        "BMTC",
        "KSRTC",
        "public transport"
      ];

      const allBusResults = [];

      for (const term of searchTerms) {
        try {
          const results = await fetchPlacesFromOSM(term, bbox, 'bus');
          if (results.length > 0) {
            console.log(`Found ${results.length} bus places for term: ${term}`);
            allBusResults.push(...results);

            if (allBusResults.length >= 8) break;
          }
        } catch (termError) {
          console.log(`Error searching for ${term}:`, termError);
        }
      }

      const uniqueBusStops = [];
      const seenCoords = new Set();

      allBusResults.forEach(stop => {
        const coordKey = `${stop.lat}_${stop.lon}`;
        if (!seenCoords.has(coordKey)) {
          seenCoords.add(coordKey);
          uniqueBusStops.push(stop);
        }
      });

      console.log(`Total unique bus stops found: ${uniqueBusStops.length}`);
      return uniqueBusStops;

    } catch (error) {
      console.error("Comprehensive bus search error:", error);
      return [];
    }
  };

  const fetchPlacesFromOSM = async (query, bbox, type) => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&bounded=1&viewbox=${bbox}&countrycodes=in&dedupe=1`;

      console.log(`Fetching ${type} with query: ${query}`);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'HerShieldApp/1.0',
          'Accept-Language': 'en'
        }
      });

      if (!response.ok) {
        console.log(`OSM API error for ${query}:`, response.status);
        return [];
      }

      const data = await response.json();
      console.log(`OSM returned ${data.length} results for ${query}`);

      return data.map(item => {

        let displayName = item.display_name || query;

        displayName = displayName
          .replace(/, Karnataka, India$/i, '')
          .replace(/, India$/i, '')
          .replace(/�/g, '')
          .trim();

        const parts = displayName.split(',');
        if (parts.length > 3) {
          displayName = parts.slice(0, 3).join(',');
        }

        return {
          place_id: item.place_id.toString(),
          lat: item.lat,
          lon: item.lon,
          type: type,
          display_name: displayName,
          original_name: item.display_name || query
        };
      });

    } catch (error) {
      console.log(`OSM fetch error for ${query}:`, error);
      return [];
    }
  };

  const isInBangaloreArea = (lat, lng) => {
    return lat > 12.8 && lat < 13.2 && lng > 77.4 && lng < 77.9;
  };

  const getEstimatedPlaces = (lat, lng) => {
    console.log("Generating estimated places");
    const places = [];

    const isUrban = isLikelyUrban(lat, lng);

    const policeNames = [
      "Police Station",
      "Local Police Station",
      "Police Outpost",
      "Traffic Police Station"
    ];

    const busNames = [
      "Bus Stand",
      "Bus Stop",
      "BMTC Bus Stand",
      "KSRTC Bus Station",
      "City Bus Stop",
      "Local Bus Stand"
    ];

    const hospitalNames = [
      "Government Hospital",
      "General Hospital",
      "Primary Health Centre",
      "Community Hospital",
      "Medical Center"
    ];

    const metroNames = [
      "Metro Station",
      "Namma Metro Station",
      "MRTS Station"
    ];

    if (isUrban) {
      console.log("Generating urban estimated places");

      for (let i = 0; i < 3; i++) {
        const offsetLat = (Math.random() * 0.02) - 0.01;
        const offsetLng = (Math.random() * 0.02) - 0.01;
        const placeLat = lat + offsetLat;
        const placeLng = lng + offsetLng;

        places.push({
          place_id: `police_est_${i}`,
          lat: placeLat.toString(),
          lon: placeLng.toString(),
          type: 'police',
          display_name: policeNames[i % policeNames.length],
          distance: calculateDistance(lat, lng, placeLat, placeLng),
          isEstimated: true
        });
      }

      for (let i = 0; i < 4; i++) {
        const offsetLat = (Math.random() * 0.01) - 0.005;
        const offsetLng = (Math.random() * 0.01) - 0.005;
        const placeLat = lat + offsetLat;
        const placeLng = lng + offsetLng;

        places.push({
          place_id: `bus_est_${i}`,
          lat: placeLat.toString(),
          lon: placeLng.toString(),
          type: 'bus',
          display_name: busNames[i % busNames.length],
          distance: calculateDistance(lat, lng, placeLat, placeLng),
          isEstimated: true
        });
      }


      for (let i = 0; i < 2; i++) {
        const offsetLat = (Math.random() * 0.025) - 0.0125;
        const offsetLng = (Math.random() * 0.025) - 0.0125;
        const placeLat = lat + offsetLat;
        const placeLng = lng + offsetLng;

        places.push({
          place_id: `hospital_est_${i}`,
          lat: placeLat.toString(),
          lon: placeLng.toString(),
          type: 'hospital',
          display_name: hospitalNames[i % hospitalNames.length],
          distance: calculateDistance(lat, lng, placeLat, placeLng),
          isEstimated: true
        });
      }

      if (isInBangaloreArea(lat, lng)) {
        for (let i = 0; i < 2; i++) {
          const offsetLat = (Math.random() * 0.03) - 0.015;
          const offsetLng = (Math.random() * 0.03) - 0.015;
          const placeLat = lat + offsetLat;
          const placeLng = lng + offsetLng;

          places.push({
            place_id: `metro_est_${i}`,
            lat: placeLat.toString(),
            lon: placeLng.toString(),
            type: 'metro',
            display_name: metroNames[i % metroNames.length],
            distance: calculateDistance(lat, lng, placeLat, placeLng),
            isEstimated: true
          });
        }
      }
    }

    return places.sort((a, b) => a.distance - b.distance);
  };

  const isLikelyUrban = (lat, lng) => {

    const majorCities = [
      { lat: 12.9716, lng: 77.5946 }, // Bangalore
      { lat: 12.2958, lng: 76.6394 }, // Mysore
      { lat: 12.9141, lng: 74.8560 }, // Mangalore
      { lat: 15.3647, lng: 75.1240 }, // Hubli
      { lat: 15.8497, lng: 74.4977 }, // Belgaum
    ];

    return majorCities.some(city =>
      calculateDistance(lat, lng, city.lat, city.lng) < 30 // Within 30km of major city
    );
  };

  const searchLocation = async (text) => {
    setQuery(text);
    if (text.length < 3) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        text
      )}&format=json&limit=8&countrycodes=in`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'HerShieldApp/1.0',
          'Accept-Language': 'en'
        }
      });

      const data = await response.json();

      const filteredResults = data
        .filter(item => {
          const name = item.display_name || '';
          return name.length > 5 &&
            !name.includes('�') &&
            !name.includes('??') &&
            name.match(/[a-zA-Z]/);
        })
        .map(item => ({
          ...item,
          display_name: item.display_name
            .replace(/�/g, '')
            .replace(/[^\x00-\x7F]/g, '')
            .trim()
        }));

      setResults(filteredResults);
    } catch (error) {
      console.error("Search error:", error);
      toast.showToast("Unable to search locations", "error");
    } finally {
      setLoading(false);
    }
  };

  const selectLocation = (item) => {
    const coord = {
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon)
    };

    Keyboard.dismiss();

    navigation.navigate("RouteDetails", {
      start: startPoint,
      end: coord,
      locationName: item.display_name
    });
  };

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    Keyboard.dismiss();
  };

  const renderNearbyPlace = (place) => {
    const getIcon = (type) => {
      switch (type) {
        case 'police': return { name: 'shield', color: '#FF3B30' };
        case 'bus': return { name: 'bus', color: '#007AFF' };
        case 'hospital': return { name: 'medical', color: '#4CAF50' };
        case 'metro': return { name: 'train', color: '#FF9800' };
        default: return { name: 'location', color: '#666' };
      }
    };

    const icon = getIcon(place.type);
    const distance = place.distance || 0;

    return (
      <TouchableOpacity
        key={place.place_id}
        onPress={() => selectLocation(place)}
        style={styles.placeItem}
      >
        <View style={[styles.placeIconContainer, { backgroundColor: `${icon.color}15` }]}>
          <Ionicons name={icon.name} size={22} color={icon.color} />
        </View>
        <View style={styles.placeContent}>
          <Text style={styles.placeTitle} numberOfLines={1}>
            {place.display_name}
          </Text>
          <View style={styles.placeFooter}>
            {place.isEstimated ? (
              <Text style={styles.estimatedBadge}>Estimated</Text>
            ) : (
              <Text style={styles.verifiedBadge}>Verified</Text>
            )}
          </View>
        </View>
        <View style={styles.distanceContainer}>
          <Text style={styles.distanceText}>
            {distance < 1 ? `${(distance * 1000).toFixed(0)} m` : `${distance.toFixed(1)} km`}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const policeStations = nearbyPlaces.filter(p => p.type === 'police').slice(0, 3);
  const busStands = nearbyPlaces.filter(p => p.type === 'bus').slice(0, 4);
  const hospitals = nearbyPlaces.filter(p => p.type === 'hospital').slice(0, 2);
  const metroStations = nearbyPlaces.filter(p => p.type === 'metro').slice(0, 2);

  return (
    <View style={styles.container}>
      <AppHeader
        title="Search Destination"
        showBack={true}
        onBack={onClose}
        variant="dark"
        showProfile={false}
      />


      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
        <TextInput
          placeholder="Search for a place in Karnataka"
          placeholderTextColor="#999"
          value={query}
          onChangeText={searchLocation}
          style={styles.searchInput}
          autoFocus={true}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={clearSearch} style={styles.clearButton}>
            <Ionicons name="close-circle" size={20} color="#999" />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#570a1c" />
          <Text style={styles.loadingText}>Searching locations...</Text>
        </View>
      ) : results.length > 0 ? (
        <FlatList
          data={results}
          keyExtractor={(item) => item.place_id.toString()}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => selectLocation(item)}
              style={styles.resultItem}
            >
              <Ionicons name="location-outline" size={22} color="#570a1c" />
              <View style={styles.resultContent}>
                <Text style={styles.resultTitle} numberOfLines={1}>
                  {item.display_name.split(',')[0]}
                </Text>
                <Text style={styles.resultAddress} numberOfLines={2}>
                  {item.display_name.split(',').slice(1, 3).join(',').trim()}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.resultsList}
          style={styles.resultsFlatList}
        />
      ) : (
        <ScrollView
          style={styles.scrollContainer}
          showsVerticalScrollIndicator={true}
          contentContainerStyle={styles.scrollContent}
        >
          {placesLoading ? (
            <View style={styles.placesLoadingContainer}>
              <ActivityIndicator size="small" color="#570a1c" />
              <Text style={styles.placesLoadingText}>Finding nearby places...</Text>
            </View>
          ) : (
            <>
              <Text style={styles.suggestionsTitle}>Nearby Important Locations</Text>
              <Text style={styles.suggestionsSubtitle}>Within 5km of your location</Text>

              {policeStations.length > 0 && (
                <>
                  <View style={styles.placeTypeHeader}>
                    <Ionicons name="shield" size={18} color="#FF3B30" />
                    <Text style={styles.placeTypeTitle}>Police Stations</Text>
                    <Text style={styles.placeCount}>({policeStations.length})</Text>
                  </View>
                  {policeStations.map(renderNearbyPlace)}
                </>
              )}

              {busStands.length > 0 && (
                <>
                  <View style={styles.placeTypeHeader}>
                    <Ionicons name="bus" size={18} color="#007AFF" />
                    <Text style={styles.placeTypeTitle}>Bus Stands & Stops</Text>
                    <Text style={styles.placeCount}>({busStands.length})</Text>
                  </View>
                  {busStands.map(renderNearbyPlace)}
                </>
              )}

              {hospitals.length > 0 && (
                <>
                  <View style={styles.placeTypeHeader}>
                    <Ionicons name="medical" size={18} color="#4CAF50" />
                    <Text style={styles.placeTypeTitle}>Hospitals & Medical Centers</Text>
                    <Text style={styles.placeCount}>({hospitals.length})</Text>
                  </View>
                  {hospitals.map(renderNearbyPlace)}
                </>
              )}

              {metroStations.length > 0 && (
                <>
                  <View style={styles.placeTypeHeader}>
                    <Ionicons name="train" size={18} color="#FF9800" />
                    <Text style={styles.placeTypeTitle}>Metro Stations</Text>
                    <Text style={styles.placeCount}>({metroStations.length})</Text>
                  </View>
                  {metroStations.map(renderNearbyPlace)}
                </>
              )}

              {nearbyPlaces.length === 0 && !placesLoading && (
                <View style={styles.noPlacesContainer}>
                  <Ionicons name="location-outline" size={40} color="#ccc" />
                  <Text style={styles.noPlacesText}>No nearby places found</Text>
                  <Text style={styles.noPlacesSubtext}>Search for a specific location above</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 50,
    paddingBottom: 15,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  backButton: {
    padding: 5,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    margin: 15,
    marginTop: 10,
    paddingHorizontal: 15,
    borderRadius: 12,
    height: 50,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: "#333",
    height: "100%",
  },
  clearButton: {
    padding: 5,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: "#666",
  },
  resultsList: {
    paddingBottom: 30,
  },
  resultsFlatList: {
    flex: 1,
  },
  resultItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  resultContent: {
    flex: 1,
    marginLeft: 15,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
    marginBottom: 3,
  },
  resultAddress: {
    fontSize: 14,
    color: "#666",
    lineHeight: 18,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 15,
    paddingBottom: 40,
  },
  suggestionsTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginTop: 10,
    marginBottom: 5,
  },
  suggestionsSubtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 20,
  },
  placesLoadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  placesLoadingText: {
    marginTop: 10,
    fontSize: 14,
    color: "#666",
  },
  placeTypeHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 25,
    marginBottom: 10,
  },
  placeTypeTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#8B133E",
    marginLeft: 8,
  },
  placeCount: {
    fontSize: 14,
    color: "#8B133E",
    marginLeft: 6,
  },
  placeItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#f0f0f0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  placeIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  placeContent: {
    flex: 1,
  },
  placeTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: "#333",
    marginBottom: 4,
  },
  placeFooter: {
    flexDirection: "row",
    alignItems: "center",
  },
  estimatedBadge: {
    fontSize: 11,
    color: "#FF9800",
    backgroundColor: "#FFF3E0",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  verifiedBadge: {
    fontSize: 11,
    color: "#4CAF50",
    backgroundColor: "#E8F5E9",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  distanceContainer: {
    backgroundColor: "#f8f9fa",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginLeft: 8,
    minWidth: 60,
    alignItems: "center",
  },
  distanceText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#570a1c",
  },
  noCategoryContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
    backgroundColor: "#f9f9f9",
    borderRadius: 10,
    marginTop: 10,
    marginBottom: 10,
  },
  noCategoryText: {
    fontSize: 14,
    color: "#999",
    marginTop: 8,
  },
  noPlacesContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  noPlacesText: {
    fontSize: 16,
    color: "#666",
    marginTop: 10,
    fontWeight: "500",
    textAlign: "center",
  },
  noPlacesSubtext: {
    fontSize: 14,
    color: "#999",
    marginTop: 5,
    textAlign: "center",
  },
});