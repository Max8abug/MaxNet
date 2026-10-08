import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, KeyboardAvoidingView, Linking, Platform, ScrollView, Text, TextInput, View } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { EmptyState, Panel, RetroButton, RetroFrame, commonStyles, colors } from "@/components/Retro";
import {
  API_ORIGIN,
  registerExpoPushToken,
  unregisterExpoPushToken,
} from "@/lib/api";
import { useMobileAuth } from "@/lib/auth-context";

export default function ProfileScreen() {
  const { user, loading, login, signup, logout } = useMobileAuth();
  const [createAccount, setCreateAccount] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const pushStorageKey = user ? `photo-desktop:push-token:${user.username}` : null;

  useEffect(() => {
    let cancelled = false;
    setPushToken(null);
    setPushStatus(null);
    if (pushStorageKey) {
      void AsyncStorage.getItem(pushStorageKey).then((token) => {
        if (!cancelled) setPushToken(token);
      }).catch(() => {
        if (!cancelled) setError("Could not read this device's notification settings.");
      });
    }
    return () => { cancelled = true; };
  }, [pushStorageKey]);

  async function submitAuth() {
    setBusy(true);
    setError(null);
    try {
      if (createAccount) await signup(username.trim(), password);
      else await login(username.trim(), password);
      setPassword("");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function togglePush() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setPushStatus(null);
    try {
      const registeredToken = pushToken || (pushStorageKey ? await AsyncStorage.getItem(pushStorageKey) : null);
      if (registeredToken) {
        await unregisterExpoPushToken(registeredToken);
        if (pushStorageKey) await AsyncStorage.removeItem(pushStorageKey);
        setPushToken(null);
        setPushStatus("Push notifications are disabled on this device.");
        return;
      }
      if (Platform.OS === "web") {
        throw new Error("Native push notifications need the iOS app.");
      }
      const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID
        || Constants.expoConfig?.extra?.eas?.projectId
        || Constants.easConfig?.projectId;
      if (!projectId) {
        throw new Error("Push setup needs an Expo EAS project ID. Configure it before creating the signed iOS build.");
      }
      const permission = await Notifications.getPermissionsAsync();
      const status = permission.granted
        ? permission.status
        : (await Notifications.requestPermissionsAsync()).status;
      if (status !== "granted") {
        throw new Error("Allow notifications in iOS Settings to receive site news alerts.");
      }
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "Site updates",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      await registerExpoPushToken(token, Platform.OS === "android" ? "android" : "ios");
      if (pushStorageKey) await AsyncStorage.setItem(pushStorageKey, token);
      setPushToken(token);
      setPushStatus("This device is registered for new site news alerts.");
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : "Could not update push settings.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      const registeredToken = pushToken || (pushStorageKey ? await AsyncStorage.getItem(pushStorageKey) : null);
      if (registeredToken) await unregisterExpoPushToken(registeredToken);
      if (pushStorageKey) await AsyncStorage.removeItem(pushStorageKey);
      setPushToken(null);
      await logout();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Sign-out failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RetroFrame title="Portfolio 98 — Profile">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={commonStyles.scroll} keyboardShouldPersistTaps="handled">
          <View>
            <Text style={commonStyles.heading}>Profile & notifications</Text>
            <Text style={commonStyles.muted}>Sign in with your existing Portfolio 98 account.</Text>
          </View>

          {error && <Panel style={commonStyles.error}><Text style={commonStyles.errorText}>{error}</Text></Panel>}

          {loading ? (
            <Panel><Text style={commonStyles.muted}>Checking your account…</Text></Panel>
          ) : user ? (
            <>
              <Panel>
                <Text style={commonStyles.subheading}>Signed in as {user.username}</Text>
                <Text style={commonStyles.muted}>{user.isAdmin ? "Site administrator" : user.rank || "Directory member"}</Text>
                <View style={{ height: 1, backgroundColor: "#c8c8c8" }} />
                <Text style={commonStyles.text}>Your native app session uses the existing account and moderation checks.</Text>
                <RetroButton title="Sign out" onPress={() => void signOut()} disabled={busy} />
              </Panel>

              <Panel>
                <Text style={commonStyles.subheading}>Site news alerts</Text>
                <Text style={commonStyles.muted}>Get a phone notification when a new site news post is published.</Text>
                <RetroButton
                  title={pushToken ? "Disable notifications on this device" : "Enable notifications"}
                  onPress={() => void togglePush()}
                  disabled={busy}
                />
                {!!pushStatus && <Text style={{ ...commonStyles.muted, color: colors.green }}>{pushStatus}</Text>}
                <Text style={commonStyles.muted}>
                  iOS push delivery requires a signed app installed through TestFlight. The Expo project ID must be configured in the native build.
                </Text>
              </Panel>
              {!!API_ORIGIN && (
                <RetroButton title="Open the website" onPress={() => void Linking.openURL(API_ORIGIN).catch(() => Alert.alert("Could not open website"))} secondary />
              )}
            </>
          ) : (
            <Panel>
              <Text style={commonStyles.subheading}>{createAccount ? "Create an account" : "Sign in"}</Text>
              <TextInput
                accessibilityLabel="Username"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Username"
                value={username}
                onChangeText={setUsername}
                style={commonStyles.input}
                returnKeyType="next"
              />
              <TextInput
                accessibilityLabel="Password"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                style={commonStyles.input}
                returnKeyType="done"
                onSubmitEditing={() => void submitAuth()}
              />
              <RetroButton title={busy ? "Please wait…" : createAccount ? "Create account" : "Sign in"} onPress={() => void submitAuth()} disabled={busy || !username.trim() || !password} />
              <RetroButton
                title={createAccount ? "Already have an account? Sign in" : "Need an account? Create one"}
                onPress={() => { setCreateAccount((value) => !value); setError(null); }}
                disabled={busy}
                secondary
              />
              <Text style={commonStyles.muted}>Your password is sent only to the existing sign-in endpoint and is not saved on this device by the app.</Text>
            </Panel>
          )}

          {!API_ORIGIN && (
            <EmptyState
              title="API address not configured"
              detail="Set EXPO_PUBLIC_API_BASE_URL for an iOS build. Do not put credentials in the app configuration."
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </RetroFrame>
  );
}
