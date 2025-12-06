// AppHeader.js
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Platform,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

export default function AppHeader({
  title = "HerShield Project",
  showProfile = true,
  showLogout = false,
  showBack = false,
  profileImage,
  variant = "dark",
  onLogout,
  onBack,
  logoSource,
  rightComponent,
  leftComponent,
}) {
  const navigation = useNavigation();
  const isDark = variant === "dark";
  const bgColor = isDark ? "#4A0D35" : "#fff";
  const textColor = isDark ? "#fff" : "#4A0D35";

  const handleBackPress = () => {
    if (typeof onBack === "function") {
      onBack();
    } else {
      navigation.goBack();
    }
  };

  const handleProfilePress = () => {
    if (showLogout) {
      if (typeof onLogout === "function") {
        onLogout();
      } else {
        navigation.replace("Auth");
      }
    } else {
      navigation.navigate("Profile");
    }
  };

  // Determine what to show on the left side (Logo or custom component)
  const renderLeftSide = () => {
    if (leftComponent) {
      return leftComponent;
    }
    
    if (logoSource) {
      return (
        <Image 
          source={logoSource}
          style={styles.logo}
          resizeMode="contain"
        />
      );
    }
    
    return null;
  };

  // Determine what to show on the right side (Back button, Profile/Logout, or custom component)
  const renderRightSide = () => {
    if (rightComponent) {
      return rightComponent;
    }
    
    // Create an array of right side buttons
    const rightButtons = [];
    
    // Add back button if needed
    if (showBack) {
      rightButtons.push(
        <TouchableOpacity 
          key="back"
          onPress={handleBackPress} 
          style={styles.iconButton}
        >
          <Ionicons name="close" size={28} color={textColor} />
        </TouchableOpacity>
      );
    }
    
    // Add profile/logout button if needed
    if (showProfile || showLogout) {
      rightButtons.push(
        <TouchableOpacity 
          key="profile"
          onPress={handleProfilePress} 
          style={styles.iconButton}
        >
          {showLogout ? (
            <Ionicons name="log-out-outline" size={28} color={textColor} />
          ) : (
            <Ionicons name="person-circle-outline" size={32} color={textColor} />
          )}
        </TouchableOpacity>
      );
    }
    
    // If no buttons, return empty space
    if (rightButtons.length === 0) {
      return <View style={{ width: 40 }} />;
    }
    
    // Return buttons in a row
    return (
      <View style={styles.rightButtonsContainer}>
        {rightButtons}
      </View>
    );
  };

  return (
    <View style={{ paddingTop: StatusBar.currentHeight, backgroundColor: bgColor }}>
      <StatusBar translucent backgroundColor={bgColor} barStyle="light-content" />

      <View style={[styles.container, { backgroundColor: bgColor }]}>

        {/* LEFT SIDE: Logo or custom component */}
        <View style={styles.leftContainer}>
          {renderLeftSide()}
        </View>

        {/* CENTER: Title */}
        <Text style={[styles.title, { color: textColor }]} numberOfLines={1}>
          {title}
        </Text>

        {/* RIGHT SIDE: Back button, Profile/Logout, or custom component */}
        <View style={styles.rightContainer}>
          {renderRightSide()}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 60,
  },
  leftContainer: {
    // width: 40,
    alignItems: 'flex-start',
  },
  rightContainer: {
    minWidth: 40,
    alignItems: 'flex-end',
  },
  rightButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12, // Space between buttons
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "left",
    flex: 1,
    marginHorizontal: 8,
  },
  iconButton: {
    padding: 8,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 25,
  },
});