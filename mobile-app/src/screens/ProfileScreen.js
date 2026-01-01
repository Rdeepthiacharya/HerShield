import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Image, ScrollView
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useToast } from "../context/ToastContext";
import PageWrapper from "../components/PageWrapper";
import FloatingLabelInput from "../components/FloatingLabelInput";
import PasswordInput from "../components/PasswordInput";
import GradientButton from "../components/GradientButton";
import BottomNav from "../components/BottomNav";
import AppHeader from "../components/AppHeader";
import { BASE_URL } from "../utils/config";

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toLocaleString();
}

export default function ProfileScreen({ navigation }) {
  const toast = useToast();
  const [user, setUser] = useState({
    id: null, fullname: "", email_id: "", mobile_no: "", birth_date: "",
    address_line_1: "", city: "", state: "", zip_code: ""
  });

  const [contacts, setContacts] = useState([]);
  const [sosLogs, setSosLogs] = useState([]);
  const [incidentReports, setIncidentReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const [newContactName, setNewContactName] = useState("");
  const [newMobileNumber, setNewMobileNumber] = useState("");
  const [newRelationship, setNewRelationship] = useState("");

  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");


  const [expandedSections, setExpandedSections] = useState({
    profile: false, address: false, security: false, contacts: false, reports: false, sos: false
  });

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const stored = await AsyncStorage.getItem("user");
        if (!stored) {
          navigation.replace("Auth");
          return;
        }
        const parsed = JSON.parse(stored);
        const email = parsed.email_id || parsed.email;

        const userRes = await fetch(`${BASE_URL}/user/${email}`);
        if (!userRes.ok) {
          const text = await userRes.text();
          console.warn("User fetch failed:", userRes.status, text.substring(0, 100));
          setLoading(false);
          return;
        }
        const userData = await userRes.json();
        if (!userData.success) {
          setLoading(false);
          return;
        }

        if (mounted) {
          setUser(userData.user);
        }

        const contactsRes = await fetch(`${BASE_URL}/trusted-contacts/${userData.user.id}`);
        if (contactsRes.ok) {
          const contactsData = await contactsRes.json();
          if (mounted) {
            console.log("Loaded contacts:", contactsData.contacts);
            setContacts(contactsData.contacts || []);
          }
        } else {
          console.warn("Failed to load contacts:", contactsRes.status);
        }

        const sosRes = await fetch(`${BASE_URL}/sos_logs/${userData.user.id}`);
        if (sosRes.ok) {
          const sosData = await sosRes.json();
          if (mounted) {
            setSosLogs(sosData.logs || []);
          }
        }

        const incRes = await fetch(`${BASE_URL}/incident_reports/${userData.user.id}`);
        if (incRes.ok) {
          const incData = await incRes.json();
          if (mounted) {
            setIncidentReports(incData.reports || []);
          }
        }

        setLoading(false);
      } catch (err) {
        console.warn("Profile loading failed", err);
        setLoading(false);
      }
    };
    load();
    return () => { mounted = false };
  }, []);

  const toggleSection = (key) => {
    setExpandedSections(s => ({ ...s, [key]: !s[key] }));
  };

  const handleSaveProfile = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${BASE_URL}/update_profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: user.id,
          fullname: user.fullname,
          mobile_no: user.mobile_no,
          birth_date: user.birth_date,
          address_line_1: user.address_line_1,
          city: user.city,
          state: user.state,
          zip_code: user.zip_code
        }),
      });

      if (!res.ok) throw new Error("Profile update failed");

      const updated = await AsyncStorage.getItem("user");
      if (updated) {
        const parsed = JSON.parse(updated);
        parsed.fullname = user.fullname;
        parsed.mobile_no = user.mobile_no;
        await AsyncStorage.setItem("user", JSON.stringify(parsed));
      }

      setEditing(false);
    } catch (err) {
      console.warn(err);
    } finally {
      setLoading(false);
    }
  };


  const handleAddContact = async () => {
    if (!newContactName.trim() || !newMobileNumber.trim()) {
      toast.showToast("Please fill in contact name and mobile number", "error");
      return;
    }

    if (contacts.length >= 5) {
      toast.showToast("You can only store 5 trusted contacts.", "error");
      return;
    }

    if (!user.id) {
      toast.showToast("User information not loaded", "error");
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`${BASE_URL}/add_contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          contact_name: newContactName.trim(),
          mobile_number: newMobileNumber.trim(),
          relationship: newRelationship.trim() || ""
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to add contact");
      }

      const data = await res.json();
      console.log("Add contact response:", data);

      if (!data.contact_id) {
        throw new Error("Invalid response from server");
      }

      const newContact = {
        contact_id: data.contact_id,
        contact_name: newContactName.trim(),
        mobile_number: newMobileNumber.trim(),
        relationship: newRelationship.trim() || "",
        created_at: new Date().toISOString()
      };

      setContacts(prev => [newContact, ...prev]);

      setNewContactName("");
      setNewMobileNumber("");
      setNewRelationship("");

      toast.showToast("Contact added successfully!", "success");

      if (!expandedSections.contacts) {
        setExpandedSections(prev => ({ ...prev, contacts: true }));
      }
    } catch (err) {
      console.error("Add contact error:", err);
      toast.showToast(err.message || "Failed to add contact", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveContact = async (contact_id) => {
    try {
      setLoading(true);
      const res = await fetch(`${BASE_URL}/remove_contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id }),
      });
      if (!res.ok) throw new Error("Failed to remove");

      setContacts(prev => prev.filter(c => c.contact_id !== contact_id));
    } catch (err) {
      console.warn(err);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!oldPass || !newPass || !confirmPass) {
      toast.showToast("Fill all password fields", "error");
      return;
    }
    if (newPass !== confirmPass) {
      toast.showToast("Passwords do not match", "error");
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`${BASE_URL}/change_password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          old_password: oldPass,
          new_password: newPass
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Password update failed");

      toast.showToast("Password changed", "success");
      setOldPass("");
      setNewPass("");
      setConfirmPass("");
    } catch (err) {
      console.warn(err);
      toast.showToast("Unable to change password", "error");
    } finally {
      setLoading(false);
    }
  };



  const handleLogout = async () => {
    try {
      setLoading(true);
      let storedEmail = null;

      const stored = await AsyncStorage.getItem("user");
      if (stored) {
        const parsed = JSON.parse(stored);
        storedEmail = parsed.email_id || parsed.email;
      }

      await AsyncStorage.removeItem("user");

      const verify = await AsyncStorage.getItem("user");
      if (verify) {
        try {
          await AsyncStorage.clear();
          console.log("AsyncStorage.clear() called as fallback during logout");
        } catch (e) {
          console.warn("Failed to clear all AsyncStorage during logout", e);
        }
      }

      if (storedEmail) {
        await fetch(`${BASE_URL}/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: storedEmail }),
        });
      }
    } catch (err) {
      console.warn("logout error", err);
    } finally {
      setLoading(false);

      navigation.reset({
        index: 0,
        routes: [{ name: "Welcome" }],
      });
    }
  };

  const ContactItem = ({ item }) => (
    <View style={styles.contactItem}>
      <Ionicons name="person-circle" size={40} style={{ marginRight: 10 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.contactText}>{item.contact_name}</Text>
        <Text style={styles.contactNumber}>{item.mobile_number}</Text>
        <Text style={styles.relationshipBadge}>{item.relationship}</Text>
      </View>
      <TouchableOpacity onPress={() => handleRemoveContact(item.contact_id)}>
        <Ionicons name="close" size={22} color="#8B133E" />
      </TouchableOpacity>
    </View>
  );

  const ReportItem = ({ item }) => (
    <View style={styles.reportItem}>
      <Ionicons name="alert-circle" size={26} color="#8B133E" style={{ marginRight: 10 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.reportText}>{item.incident_type.toUpperCase()}</Text>
        <Text style={styles.reportDesc}>{item.description}</Text>
        <Text style={styles.reportMeta}>📍 {item.place_name || "Unknown"}</Text>
        <Text style={styles.reportTime}>⏱ {formatDate(item.created_at)}</Text>
      </View>
    </View>
  );

  const SosItem = ({ item }) => (
    <View style={styles.sosItem}>
      <Ionicons name="megaphone" size={26} color="#D72638" style={{ marginRight: 10 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.reportText}>SOS Trigger: {item.trigger_type}</Text>
        {item.message && (
          <Text style={styles.reportMeta}> Statement: "{item.message}"</Text>
        )}
        {item.recipients && (
          <Text style={styles.reportMeta}> Recipients: {item.recipients}</Text>
        )}
        {item.sms_status && (
          <Text style={styles.reportMeta}> SMS Status: {item.sms_status}</Text>
        )}
        {item.location && (
          <Text style={styles.reportMeta}>📍 Location: {item.location}</Text>
        )}
        {item.timestamp && (
          <Text style={styles.reportTime}>⏱ Time: {formatDate(item.timestamp)}</Text>
        )}
      </View>
    </View>
  );

  return (
    <>
      <AppHeader title="Profile" showLogout onLogout={handleLogout} />
      <ScrollView style={{ flex: 1 }}>
        <PageWrapper loading={loading} contentContainerStyle={{ padding: 16 }}>

          <View style={styles.headerRow}>
            <Image
              source={{ uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(user.fullname || "User")}&background=8B133E&color=fff&size=180` }}
              style={styles.profileImage}
            />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.userName}>{user.fullname || "User"}</Text>
              <Text style={styles.userEmail}>{user.email_id}</Text>
            </View>
            <TouchableOpacity style={styles.editBtn} onPress={() => {
              if (editing) {

                setOldPass("");
                setNewPass("");
                setConfirmPass("");
              }
              setEditing(!editing);
            }}>
              <Ionicons name={editing ? "close" : "create"} size={22} color="#fff" />
            </TouchableOpacity>
          </View>


          <View style={styles.card}>
            <TouchableOpacity onPress={() => toggleSection("profile")}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>Personal Information</Text>
                <Ionicons name={expandedSections.profile ? "arrow-up" : "arrow-down"} size={20} />
              </View>
            </TouchableOpacity>
            {expandedSections.profile && (
              <>
                <View style={styles.addContactBlock}>
                  <FloatingLabelInput editable={editing} label="Full Name" value={user.fullname} onChangeText={(t) => setUser(s => ({ ...s, fullname: t }))} />
                  <FloatingLabelInput editable={false} label="Email" value={user.email_id} />
                  <FloatingLabelInput editable={editing} label="Mobile" value={user.mobile_no} onChangeText={(t) => setUser(s => ({ ...s, mobile_no: t.replace(/\D/g, "") }))} />
                  <FloatingLabelInput editable={editing} label="Birth Date" value={user.birth_date} onChangeText={(t) => setUser(s => ({ ...s, birth_date: t }))} />
                  <FloatingLabelInput editable={editing} label="Address" value={user.address_line_1} onChangeText={(t) => setUser(s => ({ ...s, address_line_1: t }))} />
                  <FloatingLabelInput editable={editing} label="City" value={user.city} onChangeText={(t) => setUser(s => ({ ...s, city: t }))} />
                  <FloatingLabelInput editable={editing} label="State" value={user.state} onChangeText={(t) => setUser(s => ({ ...s, state: t }))} />
                  <FloatingLabelInput editable={editing} label="PIN Code" value={user.zip_code} onChangeText={(t) => setUser(s => ({ ...s, zip_code: t.replace(/\D/g, "") }))} />

                  {editing && <GradientButton text="Save Profile" onPress={handleSaveProfile} />}
                </View>
              </>
            )}
          </View>

          <View style={styles.card}>
            <TouchableOpacity onPress={() => toggleSection("contacts")}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>Trusted Contacts ({contacts.length})</Text>
                <Ionicons name={expandedSections.contacts ? "arrow-up" : "arrow-down"} size={20} />
              </View>
            </TouchableOpacity>
            {expandedSections.contacts && (
              <>
                {editing ? (
                  <>
                    <View style={styles.addContactBlock}>
                      <FloatingLabelInput
                        label="Contact name"
                        value={newContactName}
                        onChangeText={setNewContactName}
                      />
                      <FloatingLabelInput
                        label="Mobile number"
                        value={newMobileNumber}
                        keyboardType="number-pad"
                        maxLength={10}
                        onChangeText={(t) =>
                          setNewMobileNumber(t.replace(/[^0-9]/g, ""))
                        }
                      />

                      <FloatingLabelInput
                        label="Relationship"
                        value={newRelationship}
                        onChangeText={setNewRelationship}
                      />
                      <GradientButton text="Add Contact | max(5)" onPress={handleAddContact} />
                    </View>

                    <Text
                      style={{ marginBottom: 8, color: "#666", fontWeight: "600" }}
                    >
                      {contacts.length} saved
                    </Text>

                    {contacts.length === 0 ? (
                      <Text style={styles.emptyText}>No trusted contacts yet</Text>
                    ) : (
                      contacts.map((item, index) => {
                        if (!item || !item.contact_id) {
                          console.warn("Invalid contact item:", item);
                          return null;
                        }
                        return (
                          <View key={String(item.contact_id)}>
                            {index > 0 && <View style={{ height: 8 }} />}
                            <ContactItem item={item} />
                          </View>
                        );
                      })
                    )}
                  </>
                ) : (
                  <>
                    <Text
                      style={{ marginBottom: 8, color: "#666", fontWeight: "600" }}
                    >
                      {contacts.length} saved
                    </Text>
                    {contacts.length === 0 ? (
                      <Text style={styles.emptyText}>No trusted contacts yet</Text>
                    ) : (
                      contacts.map((item, index) => {
                        if (!item || !item.contact_id) {
                          console.warn("Invalid contact item:", item);
                          return null;
                        }
                        return (
                          <View key={String(item.contact_id)}>
                            {index > 0 && <View style={{ height: 8 }} />}
                            <ContactItem item={item} />
                          </View>
                        );
                      })
                    )}
                  </>
                )}
              </>
            )}
          </View>


          <View style={styles.card}>
            <TouchableOpacity onPress={() => toggleSection("security")}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>Security</Text>
                <Ionicons
                  name={expandedSections.security ? "arrow-up" : "arrow-down"}
                  size={20}
                />
              </View>
            </TouchableOpacity>

            {expandedSections.security && (
              <>
                <View style={styles.addContactBlock}>
                  <Text style={styles.voiceTitle}>Change Password</Text>

                  <PasswordInput label="Old Password" value={oldPass} onChangeText={setOldPass} editable={editing} />
                  <PasswordInput label="New Password" value={newPass} onChangeText={setNewPass} editable={editing} />
                  <PasswordInput label="Confirm Password" value={confirmPass} onChangeText={setConfirmPass} editable={editing} />

                  {editing && (
                    <GradientButton text="Change Password" onPress={handleChangePassword} />
                  )}
                </View>
              </>
            )}
          </View>


          <View style={styles.card}>
            <TouchableOpacity onPress={() => toggleSection("sos")}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>SOS Logs</Text>
                <Ionicons name={expandedSections.sos ? "arrow-up" : "arrow-down"} size={20} />
              </View>
            </TouchableOpacity>
            {expandedSections.sos && (

              sosLogs.length === 0 ? (
                <Text style={styles.emptyText}>No SOS recorded by user.</Text>
              ) : (
                sosLogs.map((item) => (
                  <SosItem key={item.id?.toString()} item={item} />
                ))
              )
            )}
          </View>

          <View style={styles.card}>
            <TouchableOpacity onPress={() => toggleSection("reports")}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>Filed Incident Reports</Text>
                <Ionicons name={expandedSections.reports ? "arrow-up" : "arrow-down"} size={20} />
              </View>
            </TouchableOpacity>
            {expandedSections.reports && (
              incidentReports.length === 0 ? (
                <Text style={styles.emptyText}>No incidents reported by user.</Text>
              ) : (
                incidentReports.map((item) => (
                  <ReportItem key={item.id?.toString()} item={item} />
                ))
              )
            )}
          </View>

        </PageWrapper>
      </ScrollView>
      <BottomNav navigation={navigation} />
    </>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 14, padding: 10 },
  profileImage: { width: 84, height: 84, borderRadius: 18, backgroundColor: "#eee" },
  userName: { fontSize: 20, fontWeight: "700", color: "#111" },
  userEmail: { color: "#666", marginTop: 3 },
  editBtn: { backgroundColor: "#8B133E", padding: 8, borderRadius: 10 },
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 18, elevation: 3, marginTop: 10 },

  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionHeader: { fontSize: 16, fontWeight: "700", color: "#8B133E" },

  addContactBlock: { gap: 10 },
  addContactInput: { backgroundColor: "#fff", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#fca5a5" },
  addContactBlock: { marginTop: 10, backgroundColor: "#fff4f8", padding: 12, borderRadius: 10, elevation: 2 },

  contactItem: { flexDirection: "row", padding: 12, backgroundColor: "#fff1f2", borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: "#fca5a5" },
  contactText: { fontSize: 15, fontWeight: "600", color: "#333" },
  relationshipBadge: { color: "#666", fontSize: 13, fontWeight: "500" },
  contactNumber: { marginTop: 4, color: "#555" },
  reportTime: { fontSize: 11, color: "#777", fontWeight: "600", marginTop: 6 },

  reportItem: { flexDirection: "row", backgroundColor: "#fff4f8", padding: 12, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: "#fca5a5", alignItems: "center" },
  sosItem: { flexDirection: "row", backgroundColor: "#ffe5ea", padding: 12, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: "#D72638", alignItems: "center" },
  reportText: { fontWeight: "700", color: "#D72638", fontSize: 15 },
  reportDesc: { fontSize: 13, color: "#444", marginTop: 4 },
  reportMeta: { fontSize: 12, color: "#555", marginTop: 4 },
  emptyText: { textAlign: "center", color: "#999", marginTop: 10 },
  divider: {
    height: 2,
    backgroundColor: "#eee",
    marginVertical: 14,
  },
  voiceTitle: {
    marginLeft: 8,
    fontSize: 15,
    fontWeight: "600",
    color: "#4A0D35",
    marginBottom: 10,
  },
});
