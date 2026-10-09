import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import router from "../src/routes/site-settings";
import { setArchiveRow } from "./feature-archives-db";
import { useAuth } from "../../photo-desktop/src/lib/auth-store";
import { fetchFeatureArchiveState } from "../../photo-desktop/src/lib/api";

const app = express();
app.use("/api", router);
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const url = `http://127.0.0.1:${address.port}/api/site-settings/feature-archives`;
const realFetch = globalThis.fetch;

try {
  setArchiveRow(undefined);
  let response = await realFetch(url);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { archivedFeatures: [] });
  const emptyTag = response.headers.get("etag")!;
  assert.equal(response.headers.get("cache-control"), "public, no-cache");

  setArchiveRow({ archivedFeatures: ["planner", "chat", "planner", "admin", "invalid"] });
  response = await realFetch(url, { headers: { "If-None-Match": emptyTag } });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), { archivedFeatures: ["chat", "planner"] });
  assert(body.length < 100);
  assert(!/logo|background|data:/i.test(body));
  const tag = response.headers.get("etag")!;
  assert.notEqual(tag, emptyTag);
  response = await realFetch(url, { headers: { "If-None-Match": `W/${tag}`, "Cache-Control": "no-cache" } });
  assert.equal(response.status, 304);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("etag"), tag);
  setArchiveRow({ archivedFeatures: ["planner", "chat"] });
  response = await realFetch(url, { headers: { "If-None-Match": tag } });
  assert.equal(response.status, 304, "Ordering does not invalidate unchanged visibility");
  setArchiveRow({ archivedFeatures: [] });
  response = await realFetch(url, { headers: { "If-None-Match": tag } });
  assert.equal(response.status, 200, "Unarchiving invalidates prior responses");
  assert.equal(response.headers.get("etag"), emptyTag);
  console.log("PASS: public archive-only projection, empty row, small body, stable and changing ETags, 304");

  // Exercise the real client API/store with controllable network responses.
  let requests: { path: string; options?: RequestInit; resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
  globalThis.fetch = ((path: string, options?: RequestInit) => new Promise<Response>((resolve, reject) => {
    requests.push({ path, options, resolve, reject });
  })) as typeof fetch;
  const reply = (request: typeof requests[number], archivedFeatures: string[], etag = '"test"') =>
    request.resolve(new Response(JSON.stringify({ archivedFeatures }), { headers: { ETag: etag } }));
  const initial = useAuth.getState().siteSettings;
  const settings = { ...initial, logoDataUrl: "data:logo", backgroundDataUrl: "data:background", siteName: "Unchanged" };
  useAuth.setState({ siteSettings: settings, user: null });
  const events: string[][] = [];
  const stop = useAuth.subscribe((state) => events.push(state.siteSettings.archivedFeatures));

  let refresh = useAuth.getState().refreshFeatureArchives();
  assert.equal(useAuth.getState().refreshFeatureArchives(), refresh, "Overlapping polls are deduplicated");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/api/site-settings/feature-archives");
  reply(requests[0], ["planner"]);
  await refresh;
  assert.deepEqual(useAuth.getState().siteSettings, { ...settings, archivedFeatures: ["planner"] });
  assert.equal(useAuth.getState().user, null, "Guests receive archive visibility");
  assert.deepEqual(events, [["planner"]], "Subscribers receive the poll without reloading");
  const snapshot = useAuth.getState().siteSettings;

  refresh = useAuth.getState().refreshFeatureArchives();
  assert.deepEqual(requests[1].options?.headers, { "If-None-Match": '"test"' });
  requests[1].resolve(new Response(null, { status: 304 }));
  await refresh;
  assert.equal(useAuth.getState().siteSettings, snapshot, "304 causes no state replacement");
  assert.equal(events.length, 1);

  refresh = useAuth.getState().refreshFeatureArchives();
  useAuth.getState().setArchivedFeatures(["chat"]);
  reply(requests[2], ["planner"]);
  await refresh;
  assert.deepEqual(useAuth.getState().siteSettings.archivedFeatures, ["chat"], "Old poll cannot undo immediate mutation");
  refresh = useAuth.getState().refreshFeatureArchives();
  assert.deepEqual(requests[3].options?.headers, {}, "Mutation clears the old validator");
  reply(requests[3], []);
  await refresh;
  assert.deepEqual(useAuth.getState().siteSettings, { ...settings, archivedFeatures: [] });

  refresh = useAuth.getState().refreshFeatureArchives();
  requests[4].reject(new Error("Offline"));
  await refresh;
  assert.deepEqual(useAuth.getState().siteSettings.archivedFeatures, []);
  const fullRefresh = useAuth.getState().refreshSiteSettings();
  useAuth.getState().setArchivedFeatures(["news"]);
  requests[5].resolve(new Response(JSON.stringify({ ...settings, siteName: "Updated", archivedFeatures: [] })));
  await fullRefresh;
  assert.equal(useAuth.getState().siteSettings.siteName, "Updated");
  assert.deepEqual(useAuth.getState().siteSettings.archivedFeatures, ["news"], "Full settings refresh preserves a newer archive update");
  stop();
  console.log("PASS: archive-only store merge, guests, subscriptions, 304, mutation races, errors and independent full settings");

  // Explicitly check the API's 304 path without calling JSON parsing.
  const conditional = fetchFeatureArchiveState('"last"');
  requests[6].resolve(new Response(null, { status: 304 }));
  assert.equal(await conditional, null);
} finally {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}
