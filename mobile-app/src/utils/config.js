import Constants from "expo-constants";
import { Platform } from "react-native";

// src/utils/config.js
export const GEOAPIFY_API_KEY = "01e115490b5549cc9eff64708491d30e"; // or pull from secure storage


// ✅ Works to detect IP from the running host (LAN + personal hotspot)
function getExpoHostIP() {
  const hostUri = Constants.expoGoConfig?.hostUri;

  if (!hostUri) return null;
  let uri = hostUri.includes("://") ? hostUri.split("://")[1] : hostUri;
  const [host] = uri.split(":");
  return host;
}

// Optional debug print helper
function logNetworkSource(source, ip) {
  if (__DEV__ && ip) {
    console.log(`🌐 Detected ${source} IP:`, ip);
  }
}

// ✅ Detect host IP
const hostIP = getExpoHostIP();
logNetworkSource("LAN/Hotspot", hostIP);

// ✔ Stable fallback for USB/incorrect host cases
const FALLBACK_IP = "192.168.43.131"; // Your computer's usual IP

export const BASE_URL = (() => {
  // 1. Use auto detected IP if available
  if (hostIP) return `http://${hostIP}:5000`;

  // 2. If running in dev mode via USB sometimes, also try adb reverse tunneling notice
  if (__DEV__) {
    logNetworkSource("Fallback (USB possible)", FALLBACK_IP);
    return `http://${FALLBACK_IP}:5000`;
  }

  // 3. Production fallback
  return `http://${FALLBACK_IP}:5000`;
})();
