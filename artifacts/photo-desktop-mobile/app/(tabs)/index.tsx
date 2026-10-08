import { useCallback, useEffect, useState } from "react";
import { Image, RefreshControl, ScrollView, Text, View } from "react-native";
import { EmptyState, Panel, RetroButton, RetroFrame, colors, commonStyles } from "@/components/Retro";
import { fetchNews, type MobileNewsPost } from "@/lib/api";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
}

export default function NewsScreen() {
  const [posts, setPosts] = useState<MobileNewsPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setPosts(await fetchNews());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Site news could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <RetroFrame title="Portfolio 98 — Site News">
      <ScrollView
        contentContainerStyle={commonStyles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.navy} />}
      >
        <View style={commonStyles.row}>
          <View style={{ flex: 1 }}>
            <Text style={commonStyles.heading}>Site News</Text>
            <Text style={commonStyles.muted}>Announcements from the people who run the site.</Text>
          </View>
          <RetroButton title="Refresh" onPress={() => void load(true)} disabled={loading || refreshing} />
        </View>

        {error && (
          <Panel style={commonStyles.error}>
            <Text style={commonStyles.errorText}>{error}</Text>
            <RetroButton title="Try again" onPress={() => void load()} />
          </Panel>
        )}

        {loading ? (
          <Panel><Text style={commonStyles.muted}>Loading the latest news…</Text></Panel>
        ) : posts.length === 0 && !error ? (
          <EmptyState title="No news posts yet" detail="Pull down to refresh and check again." />
        ) : posts.map((post) => (
          <Panel key={post.id}>
            <Text style={commonStyles.heading}>{post.title}</Text>
            <Text style={commonStyles.muted}>{post.author} · {formatDate(post.createdAt)}</Text>
            <View style={{ height: 1, backgroundColor: "#c8c8c8" }} />
            <Text selectable style={commonStyles.text}>{post.body}</Text>
            {!!post.images?.length && (
              <View style={{ gap: 8 }}>
                {post.images.map((image, index) => (
                  <Image
                    key={`${post.id}-${index}`}
                    source={{ uri: image }}
                    resizeMode="contain"
                    style={{ width: "100%", height: 220, backgroundColor: "#e5e5e5" }}
                    accessibilityLabel={`News image ${index + 1}`}
                  />
                ))}
              </View>
            )}
          </Panel>
        ))}
      </ScrollView>
    </RetroFrame>
  );
}
