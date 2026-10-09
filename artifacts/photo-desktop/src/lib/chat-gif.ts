export async function resolveChatGif(url: string): Promise<string> {
  const response = await fetch("/api/chat/gif", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not resolve this GIF link.");
  return data.url;
}

export function verifyGifImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    const timer = setTimeout(() => finish(new Error("The GIF took too long to load. Try another link.")), 12_000);
    function finish(error?: Error) {
      clearTimeout(timer); image.onload = null; image.onerror = null;
      if (error) reject(error); else resolve();
    }
    image.onload = () => finish(image.naturalWidth ? undefined : new Error("That link did not load as an image."));
    image.onerror = () => finish(new Error("The GIF image could not load. The link may be unavailable or blocked."));
    image.src = url;
  });
}
