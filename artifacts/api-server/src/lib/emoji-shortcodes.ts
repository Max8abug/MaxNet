import { gemoji } from "gemoji";

const emojis = new Map(gemoji.flatMap(entry => entry.names.map(name => [name, entry.emoji] as const)));
// Familiar alternate spellings used by other chat apps.
for (const [alias, name] of Object.entries({
  thinking_face: "thinking",
  thumbs_up: "thumbsup",
  thumbs_down: "thumbsdown",
  face_with_tears_of_joy: "joy",
  rolling_on_the_floor_laughing: "rofl",
})) {
  const emoji = emojis.get(name);
  if (emoji) emojis.set(alias, emoji);
}

/** Expand known :names: without changing URLs, inline code, or unknown names. */
export function expandEmojiShortcodes(text: string): string {
  return text.replace(/https?:\/\/[^\s]+|`[^`\n]*`|:([a-z0-9_+-]+):/gi, (match, name: string | undefined) =>
    name ? emojis.get(name.toLowerCase()) ?? match : match,
  );
}
