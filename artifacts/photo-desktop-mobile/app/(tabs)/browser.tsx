import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Linking, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { EmptyState, Panel, RetroButton, RetroFrame, colors, commonStyles } from "@/components/Retro";
import { fetchHostedSite, fetchUsers, getHostedSiteUrl, type MobilePublicUser } from "@/lib/api";
import { useMobileAuth } from "@/lib/auth-context";

function sortUsers(users: MobilePublicUser[], mode: "popular" | "alphabetical") {
  return [...users].sort((first, second) => mode === "popular"
    ? Number(!!second.hasPage || !!second.hasHostedSite) - Number(!!first.hasPage || !!first.hasHostedSite)
      || (second.upvotes || 0) - (first.upvotes || 0)
      || first.username.localeCompare(second.username)
    : first.username.localeCompare(second.username));
}

export default function BrowserScreen() {
  const { user } = useMobileAuth();
  const [users, setUsers] = useState<MobilePublicUser[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"popular" | "alphabetical">("popular");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setUsers(await fetchUsers());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The directory could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return sortUsers(users, mode).filter((item) => !normalized || item.username.toLocaleLowerCase().includes(normalized));
  }, [users, query, mode]);

  async function openSite(username: string) {
    setOpening(username);
    try {
      const site = await fetchHostedSite(username);
      if (!site.active || !site.entryPath) {
        Alert.alert("No published HTML site", `${username} does not currently have an active mini-site.`);
        return;
      }
      const url = getHostedSiteUrl(username, site.entryPath);
      await Linking.openURL(url);
    } catch (openError) {
      Alert.alert("Could not open site", openError instanceof Error ? openError.message : "Try again later.");
    } finally {
      setOpening(null);
    }
  }

  return (
    <RetroFrame title="Web Browser — People">
      <View style={{ flex: 1, padding: 10, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={commonStyles.heading}>People</Text>
            <Text style={commonStyles.muted}>Browse members and their personal sites.</Text>
          </View>
          <RetroButton title="Refresh" onPress={() => void load(true)} disabled={loading || refreshing} />
        </View>
        <TextInput
          accessibilityLabel="Search usernames"
          placeholder="Search usernames"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          style={commonStyles.input}
        />
        <View style={commonStyles.row}>
          <Text style={commonStyles.muted}>Sort by</Text>
          <RetroButton title={mode === "popular" ? "Popularity ✓" : "Popularity"} onPress={() => setMode("popular")} secondary={mode !== "popular"} />
          <RetroButton title={mode === "alphabetical" ? "A–Z ✓" : "A–Z"} onPress={() => setMode("alphabetical")} secondary={mode !== "alphabetical"} />
        </View>
        {error && (
          <Panel style={commonStyles.error}>
            <Text style={commonStyles.errorText}>{error}</Text>
            <RetroButton title="Try again" onPress={() => void load()} />
          </Panel>
        )}
        {loading ? (
          <Panel><Text style={commonStyles.muted}>Loading members…</Text></Panel>
        ) : visibleUsers.length === 0 ? (
          <EmptyState title={query ? "No matching members" : "No members found"} detail="Try another search or refresh the directory." />
        ) : (
          <FlatList
            data={visibleUsers}
            keyExtractor={(item) => item.username}
            contentContainerStyle={{ gap: 8, paddingBottom: 28 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.navy} />}
            renderItem={({ item }) => (
              <Panel style={{ padding: 10 }}>
                <View style={commonStyles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={[commonStyles.subheading, item.isAdmin && { color: colors.red }]}>{item.username}</Text>
                    <Text style={commonStyles.muted}>{item.isAdmin ? "Site administrator" : item.rank || "Directory member"}</Text>
                  </View>
                  <Text style={commonStyles.muted}>{item.lastSeen ? "Active recently" : "No recent activity"}</Text>
                </View>
                <View style={commonStyles.row}>
                  {!!item.hasPage && <Text style={commonStyles.muted}>Canvas page · {item.upvotes || 0} votes</Text>}
                  {!!item.hasHostedSite && <Text style={{ color: colors.green, fontSize: 11, fontWeight: "700" }}>Published HTML site</Text>}
                  {item.hasHostedSite && (
                    <Pressable
                      onPress={() => void openSite(item.username)}
                      disabled={opening !== null || (!user && !item.hasHostedSite)}
                      style={{ marginLeft: "auto" }}
                    >
                      <View style={{ borderWidth: 1, borderColor: colors.navy, backgroundColor: "#e7efff", paddingHorizontal: 10, paddingVertical: 7 }}>
                        <Text style={{ color: colors.navy, fontWeight: "700" }}>{opening === item.username ? "Opening…" : "Open site"}</Text>
                      </View>
                    </Pressable>
                  )}
                </View>
              </Panel>
            )}
          />
        )}
      </View>
    </RetroFrame>
  );
}
