import "dotenv/config";

export default {
  expo: {
    name: "HerShield",
    slug: "hershield",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon/app-favicon.png",
    userInterfaceStyle: "light",

    splash: {
      image: "./assets/icon/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },

    assetBundlePatterns: ["**/*"],
    jsEngine: "jsc",

    android: {
      package: "com.hershield.project",   // ← taken from app.json
      usesCleartextTraffic: true,

      adaptiveIcon: {
        foregroundImage: "./assets/icon/adaptive-icon.png",
        backgroundColor: "#ffffff"
      },

      permissions: [
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.RECORD_AUDIO",
        "android.permission.CALL_PHONE",
        "android.permission.SEND_SMS",
        "android.permission.VIBRATE",
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.FOREGROUND_SERVICE"
      ]
    },

    plugins: [
      [
        "expo-notifications",
        {
          icon: "./assets/icon/app-favicon.png",
          color: "#8B133E",
          defaultChannel: "default"
        }
      ],
      "expo-font"
    ],

    extra: {
      GEOAPIFY_KEY: process.env.GEOAPIFY_KEY || "",
      BASE_URL: process.env.BASE_URL || "http://localhost:5000",
    }
  }
};
