import { useEffect, useState } from "react";
import { NativeModules, NativeEventEmitter } from "react-native";

const { WakeBridgeModule } = NativeModules;
const eventEmitter = new NativeEventEmitter(WakeBridgeModule);

export default function VoiceMonitor(userId, apiRoot, onDanger) {
  const [isMonitoring, setIsMonitoring] = useState(false);

  // ----------------- Start Monitoring -----------------
  const startMonitoring = async () => {
    if (!userId) {
      console.log("User not loaded — cannot start monitor.");
      return;
    }

    try {
      WakeBridgeModule.startService(String(userId));
      setIsMonitoring(true);
      console.log("🔊 Voice Monitor Started");
    } catch (e) {
      console.log("Start monitor error:", e);
    }
  };

  // ----------------- Stop Monitoring -----------------
  const stopMonitoring = () => {
    try {
      WakeBridgeModule.stopService();
      setIsMonitoring(false);
      console.log("🛑 Voice Monitor Stopped");
    } catch (e) {
      console.log("Stop monitor error:", e);
    }
  };

  // ----------------- Handler for Wake Word Event -----------------
  const handleWakeWord = async () => {
    console.log("🚨 Wake-word detected!");

    try {
      const base64Audio = await WakeBridgeModule.getLastAudio();
      if (!base64Audio || base64Audio.length < 10) {
        console.log("No audio file received from service.");
        return;
      }

      // Send to backend
      const form = new FormData();
      form.append("user_id", String(userId));
      form.append("wake_word_detected", "true");

      form.append("audio", {
        uri: `data:audio/wav;base64,${base64Audio}`,
        type: "audio/wav",
        name: "wake_audio.wav",
      });

      const res = await fetch(`${apiRoot}/analyze_audio`, {
        method: "POST",
        body: form,
      });

      const data = await res.json();
      console.log("🎧 analyze_audio response:", data);

      if (data.auto_sos && typeof onDanger === "function") {
        onDanger(data);
      }
    } catch (err) {
      console.log("Wake-word upload error:", err);
    }
  };

  // ----------------- Subscribe to Wake Events -----------------
  useEffect(() => {
    const sub = eventEmitter.addListener("WakeWordDetected", handleWakeWord);

    return () => {
      sub.remove();
      stopMonitoring();
    };
  }, [userId]);

  return { isMonitoring, startMonitoring, stopMonitoring };
}
