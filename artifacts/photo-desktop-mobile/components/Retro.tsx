import React from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

export const colors = {
  teal: "#008080",
  panel: "#c0c0c0",
  lightPanel: "#d8d8d8",
  navy: "#000080",
  white: "#ffffff",
  ink: "#111111",
  muted: "#575757",
  border: "#7c7c7c",
  green: "#08752b",
  red: "#9b0000",
};

export function RetroFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.window}>
        <View style={styles.titleBar}>
          <Text style={styles.titleText} numberOfLines={1}>{title}</Text>
          <View style={styles.titleMark}><Text style={styles.titleMarkText}>PD</Text></View>
        </View>
        <View style={styles.content}>{children}</View>
      </View>
    </SafeAreaView>
  );
}

export function Panel({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function RetroButton({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={[styles.buttonText, disabled && styles.disabledText]}>{title}</Text>
    </Pressable>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <Panel style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {!!detail && <Text style={styles.muted}>{detail}</Text>}
    </Panel>
  );
}

export const commonStyles = StyleSheet.create({
  scroll: { padding: 12, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  heading: { fontSize: 18, fontWeight: "700", color: colors.navy },
  subheading: { fontSize: 14, fontWeight: "700", color: colors.navy },
  text: { fontSize: 14, lineHeight: 20, color: colors.ink },
  muted: { fontSize: 12, lineHeight: 17, color: colors.muted },
  error: { borderWidth: 1, borderColor: colors.red, backgroundColor: "#fff9da", padding: 10 },
  errorText: { fontSize: 13, color: colors.red, lineHeight: 18 },
  input: { minHeight: 42, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, paddingHorizontal: 10, paddingVertical: 8, color: colors.ink, fontSize: 15 },
  divider: { height: 1, backgroundColor: "#b5b5b5", marginVertical: 6 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.teal },
  window: { flex: 1, margin: 8, borderWidth: 2, borderTopColor: "#f2f2f2", borderLeftColor: "#f2f2f2", borderRightColor: "#555", borderBottomColor: "#555", backgroundColor: colors.panel, overflow: "hidden" },
  titleBar: { minHeight: 42, backgroundColor: colors.navy, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleText: { flex: 1, color: colors.white, fontSize: 16, fontWeight: "700" },
  titleMark: { width: 28, height: 26, backgroundColor: colors.panel, borderWidth: 2, borderTopColor: "#fff", borderLeftColor: "#fff", borderRightColor: "#555", borderBottomColor: "#555", alignItems: "center", justifyContent: "center", marginLeft: 8 },
  titleMarkText: { fontSize: 10, color: colors.navy, fontWeight: "900" },
  content: { flex: 1, minHeight: 0, backgroundColor: colors.lightPanel },
  panel: { borderWidth: 1, borderTopColor: "#fff", borderLeftColor: "#fff", borderRightColor: colors.border, borderBottomColor: colors.border, backgroundColor: colors.white, padding: 12, gap: 8 },
  button: { minHeight: 40, borderWidth: 2, borderTopColor: "#fff", borderLeftColor: "#fff", borderRightColor: "#555", borderBottomColor: "#555", backgroundColor: colors.panel, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, paddingVertical: 8 },
  secondaryButton: { backgroundColor: "#e8e8e8" },
  buttonPressed: { borderTopColor: "#555", borderLeftColor: "#555", borderRightColor: "#fff", borderBottomColor: "#fff" },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: colors.ink, fontSize: 14, fontWeight: "700", textAlign: "center" },
  disabledText: { color: colors.muted },
  empty: { alignItems: "center", paddingVertical: 24 },
  emptyTitle: { color: colors.navy, fontSize: 16, fontWeight: "700", textAlign: "center" },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 17, textAlign: "center" },
});
