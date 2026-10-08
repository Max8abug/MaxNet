import { useCallback, useEffect, useState } from "react";
import { Alert, Image, Linking, ScrollView, Text, View } from "react-native";
import { EmptyState, Panel, RetroButton, RetroFrame, commonStyles, colors } from "@/components/Retro";
import { API_ORIGIN, fetchWikiPage, fetchWikiPages, type MobileWikiAsset, type MobileWikiPage, type MobileWikiPageSummary } from "@/lib/api";

function MarkdownText({ content }: { content: string }) {
  return (
    <View style={{ gap: 7 }}>
      {content.split(/\r?\n/).map((line, index) => {
        const heading = /^(#{1,6})\s+(.+)$/.exec(line);
        if (heading) {
          return <Text key={index} style={{ color: colors.navy, fontSize: Math.max(15, 22 - heading[1].length), fontWeight: "700" }}>{heading[2]}</Text>;
        }
        if (/^\s*[-*]\s+/.test(line)) {
          return <Text key={index} style={commonStyles.text}>• {line.replace(/^\s*[-*]\s+/, "")}</Text>;
        }
        if (/^\s*\d+\.\s+/.test(line)) {
          return <Text key={index} style={commonStyles.text}>{line.trim()}</Text>;
        }
        if (/^\s*>/.test(line)) {
          return <Text key={index} style={{ ...commonStyles.text, color: colors.muted, borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: 8 }}>{line.replace(/^\s*>\s?/, "")}</Text>;
        }
        return line.trim() ? <Text key={index} selectable style={commonStyles.text}>{line}</Text> : <View key={index} style={{ height: 2 }} />;
      })}
    </View>
  );
}

function AssetCard({ asset }: { asset: MobileWikiAsset }) {
  const url = `${API_ORIGIN}${asset.url}`;
  if (asset.contentType.startsWith("image/")) {
    return (
      <Panel>
        <Image source={{ uri: url }} resizeMode="contain" style={{ width: "100%", height: 220, backgroundColor: "#e8e8e8" }} accessibilityLabel={asset.fileName} />
        <Text style={commonStyles.muted}>{asset.fileName}</Text>
      </Panel>
    );
  }
  return (
    <Panel style={commonStyles.row}>
      <Text style={{ flex: 1, ...commonStyles.text }}>{asset.fileName}</Text>
      <RetroButton title="Watch" onPress={() => void Linking.openURL(url).catch(() => Alert.alert("Could not open video"))} />
    </Panel>
  );
}

export default function WikiScreen() {
  const [pages, setPages] = useState<MobileWikiPageSummary[]>([]);
  const [page, setPage] = useState<MobileWikiPage | null>(null);
  const [assets, setAssets] = useState<MobileWikiAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadIndex = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPages(await fetchWikiPages());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The wiki could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIndex();
  }, [loadIndex]);

  async function openPage(slug: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchWikiPage(slug);
      setPage(result.page);
      setAssets(result.assets);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "This wiki page could not be opened.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <RetroFrame title="Portfolio 98 — Site Wiki">
      <ScrollView contentContainerStyle={commonStyles.scroll}>
        <View style={commonStyles.row}>
          {page ? (
            <RetroButton title="‹ Pages" onPress={() => { setPage(null); setAssets([]); }} />
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={commonStyles.heading}>Site Wiki</Text>
              <Text style={commonStyles.muted}>Community guides and references.</Text>
            </View>
          )}
          {!page && <RetroButton title="Refresh" onPress={() => void loadIndex()} disabled={loading} />}
        </View>

        {error && <Panel style={commonStyles.error}><Text style={commonStyles.errorText}>{error}</Text></Panel>}
        {loading ? (
          <Panel><Text style={commonStyles.muted}>Loading wiki…</Text></Panel>
        ) : page ? (
          <Panel>
            <Text style={commonStyles.heading}>{page.title}</Text>
            <Text style={commonStyles.muted}>Updated by {page.updatedBy} · {new Date(page.updatedAt).toLocaleDateString()}</Text>
            <View style={{ height: 1, backgroundColor: "#c8c8c8" }} />
            <MarkdownText content={page.content || "This page is empty."} />
            {!!assets.length && (
              <>
                <View style={{ height: 1, backgroundColor: "#c8c8c8", marginVertical: 4 }} />
                <Text style={commonStyles.subheading}>Page media</Text>
                {assets.map((asset) => <AssetCard key={asset.id} asset={asset} />)}
              </>
            )}
          </Panel>
        ) : pages.length === 0 ? (
          <EmptyState title="No wiki pages yet" detail="Pages will appear here when the community adds them." />
        ) : pages.map((item) => (
          <Panel key={item.slug}>
            <Text style={commonStyles.subheading}>{item.title}</Text>
            <Text style={commonStyles.muted}>{item.excerpt || "No summary yet."}</Text>
            <Text style={commonStyles.muted}>Updated by {item.updatedBy}</Text>
            <RetroButton title="Read page" onPress={() => void openPage(item.slug)} />
          </Panel>
        ))}
      </ScrollView>
    </RetroFrame>
  );
}
