import Constants from "expo-constants";

// Get from app.config.js (which reads from .env)
const config = Constants.expoConfig.extra;
export const GEOAPIFY_KEY = config.GEOAPIFY_KEY;
export const BASE_URL = config.BASE_URL;

console.log("🔧 App Config:", {
  geoapify: GEOAPIFY_KEY ? "✅" : "❌",
  baseUrl: BASE_URL,
  usingNgrok: BASE_URL.includes('ngrok.io')
});

setTimeout(() => {
  console.log("🔍 Testing connection to:", `${BASE_URL}/health`);
  fetch(`${BASE_URL}/health`, { method: "GET" })
    .then(response => {
      console.log("📡 Health check result:", response.status, response.ok);
      return response.text();
    })
    .then(text => console.log("📄 Response:", text))
    .catch(error => console.log("❌ Connection test failed:", error.message));
}, 2000);