interface EaglercraftServer {
  addr: string;
  name: string;
  [key: string]: unknown;
}
export interface EaglercraftLaunchOptions {
  servers?: EaglercraftServer[];
}

const defaultServer: EaglercraftServer = {
  addr: "wss://s1.sladenator.net",
  name: "Sladenators server",
};

export function configureEaglercraftServers(options: EaglercraftLaunchOptions): void {
  const existing = Array.isArray(options.servers) ? options.servers : [];
  options.servers = [
    { ...defaultServer },
    ...existing.filter(server => typeof server?.addr === "string"
      && server.addr.trim().replace(/^wss?:\/\//i, "").replace(/\/$/, "").toLowerCase() !== "s1.sladenator.net"),
  ];
}
