// Only served by the isolated backup regression runner, never the real app.
import React from "react";
import { createRoot } from "react-dom/client";
import { SiteBackup } from "../src/components/SiteBackup";
import { useAuth } from "../src/lib/auth-store";
import type { AuthUser } from "../src/lib/api";

useAuth.setState({
  user: {
    username: "Disposable backup administrator",
    isAdmin: true,
  } as AuthUser,
  loading: false,
});
createRoot(document.getElementById("root")!).render(
  <main
    style={{ maxWidth: 900, margin: "20px auto", height: "calc(100vh - 40px)" }}
  >
    <h1>Disposable backup verification</h1>
    <SiteBackup />
  </main>,
);
