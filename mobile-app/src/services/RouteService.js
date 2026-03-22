import { BASE_URL } from "../utils/config";

const API_URL = BASE_URL;

class RouteService {
  static cache = {};
  static CACHE_TTL = 2 * 60 * 1000;
  static currentAbortController = null;

  static roundCoord(value, precision = 4) {
    return Number.parseFloat(value).toFixed(precision);
  }

  static buildCacheKey(start, end, options = {}) {
    const mode = options.mode || "walk";
    const multiple = options.multiple ? "multi" : "single";

    return [
      this.roundCoord(start.latitude),
      this.roundCoord(start.longitude),
      this.roundCoord(end.latitude),
      this.roundCoord(end.longitude),
      mode,
      multiple
    ].join("_");
  }

  static isCacheValid(cacheEntry) {
    return cacheEntry && Date.now() - cacheEntry.timestamp < this.CACHE_TTL;
  }

  static abortOngoingRequest() {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  // ================= CORE FETCH =================
  static async fetchRoute(startCoords, endCoords, options = {}) {
    if (!startCoords || !endCoords) {
      return { success: false, error: "Invalid coordinates" };
    }

    const cacheKey = this.buildCacheKey(startCoords, endCoords, options);
    const cached = this.cache[cacheKey];

    if (this.isCacheValid(cached)) {
      console.log("RouteService: Using cached route");
      return { success: true, data: cached.data, fromCache: true };
    }

    this.abortOngoingRequest();
    this.currentAbortController = new AbortController();

    try {
      console.log("RouteService: Fetching new route");

      const response = await fetch(`${API_URL}/safe_route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: this.currentAbortController.signal,
        body: JSON.stringify({
          start: {
            lat: startCoords.latitude,
            lng: startCoords.longitude
          },
          end: {
            lat: endCoords.latitude,
            lng: endCoords.longitude
          },
          mode: options.mode || "walk",
          multiple: !!options.multiple   // 🔑 CRITICAL
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        return { success: false, error: "No route found" };
      }

      // 🔁 NORMALIZE RESPONSE
      const normalized = {
        routes: data.routes
          ? data.routes
          : data.route
            ? [data.route]
            : []
      };

      this.cache[cacheKey] = {
        data: normalized,
        timestamp: Date.now()
      };

      return { success: true, data: normalized };

    } catch (err) {
      if (err.name === "AbortError") {
        return { success: false, aborted: true };
      }

      console.error("❌ RouteService error:", err);
      return { success: false, error: "Network error" };

    } finally {
      this.currentAbortController = null;
    }
  }

  static async getRoute(startCoords, endCoords, options = {}) {
    return this.getSingleRoute(startCoords, endCoords, options.mode);
  }

  // ================= SINGLE ROUTE =================
  static async getSingleRoute(startCoords, endCoords, mode = "walk") {
    const result = await this.fetchRoute(startCoords, endCoords, {
      mode,
      multiple: false
    });

    if (result.success && result.data.routes.length > 0) {
      return { success: true, route: result.data.routes[0] };
    }

    return { success: false, error: "No route found" };
  }

  // ================= MULTIPLE ROUTES =================
  static async getMultipleRoutes(startCoords, endCoords, mode = "walk") {
    const result = await this.fetchRoute(startCoords, endCoords, {
      mode,
      multiple: true
    });

    if (result.success && result.data.routes.length > 0) {
      return {
        success: true,
        routes: result.data.routes
      };
    }

    return { success: false, error: "No routes returned" };
  }

  static clearCache() {
    this.cache = {};
    console.log("🧹 RouteService: Cache cleared");
  }
}

export { RouteService };
console.log(
  "🧪 RouteService loaded with:",
  Object.getOwnPropertyNames(RouteService)
);
