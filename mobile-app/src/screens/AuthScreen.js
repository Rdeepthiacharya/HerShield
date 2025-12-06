import { useState, useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation, useRoute } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import PageWrapper from "../components/PageWrapper";
import GradientButton from "../components/GradientButton";
import FloatingLabelInput from "../components/FloatingLabelInput";
import PasswordInput from "../components/PasswordInput";
import { BASE_URL } from "../utils/config";

export default function AuthScreen() {
  const navigation = useNavigation();
  const route = useRoute();

  const [isLogin, setIsLogin] = useState(true);
  const [fullname, setFullname] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");
  const [loading, setLoading] = useState(false);

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setStatusMessage("");
    setStatusType("");
  };

  useEffect(() => {
    if (route.params?.mode === "signup") setIsLogin(false);
    else setIsLogin(true);
  }, [route.params]);

  const isValidEmail = (email) => {
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    return emailRegex.test(email);
  };

  const passwordRules = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[@$!%*?&]/.test(password),
  };
  const isPasswordStrong = Object.values(passwordRules).every(Boolean);

  const validateInputs = () => {
    if (!isValidEmail(email)) return false;
    if (!password) return false;
    if (!isLogin) {
      if (!fullname.trim()) return false;
      if (!/^\d{10}$/.test(mobile)) return false;
      if (!isPasswordStrong) return false;
      if (password !== confirmPassword) return false;
    }
    return true;
  };

  const clearFields = () => {
    setFullname("");
    setEmail("");
    setMobile("");
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async () => {
    if (!validateInputs()) return;
    setLoading(true);

    const url = `${BASE_URL}/${isLogin ? "login" : "signup"}`;
    const bodyData = isLogin
      ? { email, password }
      : { fullname, email, password, mobile_no: mobile };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyData),
      });

      const data = await response.json();

      if (response.ok) {
        setStatusType("success");
        setStatusMessage(data.message || "Success!");

        if (isLogin) {
          await AsyncStorage.setItem("user", JSON.stringify(data.user));
          navigation.replace("Dashboard", { email: data.user.email_id });
        } else {
          clearFields();
          setTimeout(() => {
            setIsLogin(true);
            setStatusMessage("");
          }, 1000);
        }
      } else {
        setStatusType("error");
        setStatusMessage(data.error || "Something went wrong.");
      }
    } catch (err) {
      setStatusType("error");
      setStatusMessage("Unable to connect to server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={["#4A0D35", "#8B133E"]}
      style={{ flex: 1, paddingHorizontal: 20, paddingTop: 100 }}
    >
      <PageWrapper loading={loading} style={{ flex: 1, margintop: 67 }}>
        <View style={styles.container}>
          <Text style={styles.title}>
            {isLogin ? "Welcome Back" : "Create Your Account"}
          </Text>
          <Text style={styles.subtitle}>
            {isLogin ? "Sign in to continue" : "Join us today"}
          </Text>
        </View>

        <View style={styles.card}>
          {!isLogin && (
            <FloatingLabelInput
              label="Full Name"
              value={fullname}
              onChangeText={setFullname}
            />
          )}

          <FloatingLabelInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            borderColor={
              email && !isValidEmail(email) ? "#ff8080" : "rgba(0,0,0,0.2)"
            }
            error={
              email.length > 0 && !isValidEmail(email)
                ? "Please enter a valid email"
                : ""
            }
          />

          {!isLogin && (
            <FloatingLabelInput
              label="Mobile Number"
              value={mobile}
              onChangeText={(t) =>
                setMobile(t.replace(/[^0-9]/g, "").slice(0, 10))
              }
              keyboardType="numeric"
              error={
                mobile.length > 0 && mobile.length < 10
                  ? "Mobile number must be 10 digits"
                  : ""
              }
            />
          )}

          <PasswordInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            error={
              !isLogin && password.length > 0 && !isPasswordStrong
                ? "Password is not strong enough"
                : ""
            }
          />

          {!isLogin && password.length > 0 && !isPasswordStrong && (
            <View style={{ marginBottom: 10 }}>
              {Object.entries({
                "At least 8 characters": passwordRules.length,
                "One uppercase letter": passwordRules.uppercase,
                "One lowercase letter": passwordRules.lowercase,
                "One number": passwordRules.number,
                "One special character": passwordRules.special,
              }).map(([rule, valid]) => (
                <Text
                  key={rule}
                  style={{
                    color: valid ? "#2E7D32" : "#C62828",
                    fontSize: 13,
                  }}
                >
                  {valid ? "✓ " : "• "} {rule}
                </Text>
              ))}
            </View>
          )}

          {!isLogin && (
            <PasswordInput
              label="Confirm Password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              error={
                confirmPassword.length > 0 && confirmPassword !== password
                  ? "Passwords do not match"
                  : ""
              }
            />
          )}

          <GradientButton
            text={isLogin ? "SIGN IN" : "SIGN UP"}
            onPress={handleSubmit}
            disabled={!validateInputs() || loading}
          />

          {statusMessage !== "" && (
            <Text
              style={{
                textAlign: "center",
                marginTop: 12,
                color: statusType === "success" ? "#2E7D32" : "#C62828",
              }}
            >
              {statusMessage}
            </Text>
          )}

          <View style={styles.switchContainer}>
            <Text style={styles.switchText}>
              {isLogin ? "Don't have an account?" : "Already have an account?"}
            </Text>
            <Text style={styles.switchLink} onPress={toggleMode}>
              {isLogin ? " Sign up" : " Sign in"}
            </Text>
          </View>
        </View>
      </PageWrapper>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", marginBottom: 20 },
  title: { color: "#fff", fontSize: 28, fontWeight: "800", marginBottom: 5 },
  subtitle: { color: "rgba(255,255,255,0.8)", fontSize: 16 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
  },
  switchContainer: { alignItems: "center", marginTop: 20 },
  switchText: { color: "#666", fontSize: 14 },
  switchLink: { color: "#8B133E", fontSize: 14, fontWeight: "700" },
});