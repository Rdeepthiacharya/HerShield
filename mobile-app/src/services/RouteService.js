import { BASE_URL } from "../utils/config";

const API_URL = BASE_URL;

export class RouteService {
  static async getMultipleRoutes(startCoords, endCoords) {
    try {
      const response = await fetch(`${API_URL}/safe_route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: { 
            lat: startCoords.latitude, 
            lng: startCoords.longitude 
          },
          end: { 
            lat: endCoords.latitude, 
            lng: endCoords.longitude 
          }
          // Note: We're NOT passing mode parameter, so backend returns multiple routes
        })
      });

      const data = await response.json();
      
      if (data.success && data.routes && data.routes.length > 0) {
        return {
          success: true,
          routes: data.routes,
          hasAlternatives: data.has_alternatives,
          riskZonesCount: data.risk_zones_count
        };
      } else {
        return {
          success: false,
          error: data.message || "No routes found"
        };
      }
    } catch (error) {
      console.error("Route fetch error:", error);
      return {
        success: false,
        error: "Network error. Please check your connection."
      };
    }
  }

  static async getSingleRoute(startCoords, endCoords) {
    try {
      const response = await fetch(`${API_URL}/safe_route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: { 
            lat: startCoords.latitude, 
            lng: startCoords.longitude 
          },
          end: { 
            lat: endCoords.latitude, 
            lng: endCoords.longitude 
          },
          mode: "single" // Request single route
        })
      });

      const data = await response.json();
      
      if (data.success && data.routes && data.routes.length > 0) {
        return {
          success: true,
          route: data.routes[0] // Return first route only
        };
      } else {
        return {
          success: false,
          error: data.message || "No route found"
        };
      }
    } catch (error) {
      console.error("Route fetch error:", error);
      return {
        success: false,
        error: "Network error. Please check your connection."
      };
    }
  }
}