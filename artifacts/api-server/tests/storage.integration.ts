// Opt-in live-storage checks. Only newly generated test identities/keys are deleted.
import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { db, pool, usersTable, ranksTable, wikiPagesTable, wikiAssetsTable, hostedSitesTable, hostedSiteFilesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import wiki from "../src/routes/wiki";
import sites from "../src/routes/hosted-sites";
import { appStorage } from "../src/lib/app-storage";
import { localStorage } from "../src/lib/local-storage";

const id = randomUUID().slice(0, 8);
// Signup allows punctuation: URI encoding alone does not make it disk-safe.
const owner = `storage-${id}'!()*~`;
const stranger = `other-${id}`;
const rank = `storage-${id}`;
const slug = `storage-${id}`;
const quota = 2048;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2sAAAAASUVORK5CYII=", "base64");
// A real 16x16 one-frame MP4, generated with ffmpeg, for media serving checks.
const video = Buffer.from("AAAAIGZ0eXBpc29tAAACAGlzb21pc282aXNvMm1wNDEAAAL3bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAAAAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAh50cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAG6bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABZW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASVzdGJsAAAA2XN0c2QAAAAAAAAAAQAAAMltcDR2AAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABCkxhdmMgbXBlZzQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAT2VzZHMAAAAAA4CAgD4AAQAEgICAMCARAAAAAAMNQAADDUAFgICAHgAAAbABAAABtYkTAAABAAAAASAAxI2IAM0AhAIUYwaAgIABAgAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAw1AAAMNQAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAAKG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAAAAD11ZHRhAAAANW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAACGlsc3QAAABwbW9vZgAAABBtZmhkAAAAAAAAAAEAAABYdHJhZgAAACR0ZmhkAAAAOQAAAAEAAAAAAAADFwAAAgAAAAASAQEAAAAAABR0ZmR0AQAAAAAAAAAAAAAAAAAAGHRydW4AAAAFAAAAAQAAAHgCAAAAAAAAGm1kYXQAAAGzABAHAAABthBgUYI9t+8AAABDbWZyYQAAACt0ZnJhAQAAAAAAAAEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAxcBAQEAAAAQbWZybwAAAAAAAABD", "base64");
const disk = await mkdtemp(path.join(tmpdir(), "photo-storage-"));
const app = express();
app.use(express.json({ limit: "10mb" }));
// A test-only session boundary: route permissions still read actual ranks/users.
app.use((req, _res, next) => {
  const username = req.get("x-test-user");
  req.session = (username ? { userId: 1, username, isAdmin: false } : {}) as typeof req.session;
  next();
});
app.use("/api", wiki, sites);
app.use(((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Unexpected test server error" });
}) as express.ErrorRequestHandler);
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;

async function request(url: string, method = "GET", body?: unknown, username?: string, expected = 200) {
  const response = await fetch(base + url, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(username ? { "x-test-user": username } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, expected, `${method} ${url}: ${bytes.toString().slice(0, 300)}`);
  return {
    bytes, headers: response.headers,
    json: () => JSON.parse(bytes.toString()),
  };
}
const site = `/custom-sites/${encodeURIComponent(owner)}`;
async function put(filePath: string, data: Buffer, expected = 200, username = owner) {
  return request(`${site}/file`, "PUT", { path: filePath, dataBase64: data.toString("base64") }, username, expected);
}
async function cleanup() {
  const assets = await db.select().from(wikiAssetsTable).where(eq(wikiAssetsTable.pageSlug, slug));
  const files = await db.select().from(hostedSiteFilesTable).where(eq(hostedSiteFilesTable.username, owner));
  for (const file of [...assets, ...files]) {
    const result = await appStorage.delete(file.objectKey, { ignoreNotFound: true });
    assert(result.ok, "Disposable storage cleanup failed");
  }
  await db.delete(wikiAssetsTable).where(eq(wikiAssetsTable.pageSlug, slug));
  await db.delete(wikiPagesTable).where(eq(wikiPagesTable.slug, slug));
  await db.delete(hostedSiteFilesTable).where(eq(hostedSiteFilesTable.username, owner));
  await db.delete(hostedSitesTable).where(eq(hostedSitesTable.username, owner));
}
try {
  await db.insert(ranksTable).values({ name: rank, permissions: ["editWiki", "createHtmlPage"], siteStorageLimitBytes: quota });
  await db.insert(usersTable).values([
    { username: owner, passwordHash: "unusable-test-hash", rank },
    { username: stranger, passwordHash: "unusable-test-hash" },
  ]);
  process.env.UPLOAD_STORAGE_DIR = disk;
  process.env.STORAGE_BACKEND = "local";
  for (const key of ["../escape", "/absolute", "a/../b", "a\\b", "a//b"]) {
    assert.equal((await localStorage.uploadFromBytes(key, png)).ok, false);
    assert.equal((await localStorage.delete(key)).ok, false);
  }
  const blocker = path.join(disk, "not-a-directory");
  await writeFile(blocker, "test");
  process.env.UPLOAD_STORAGE_DIR = blocker;
  assert.equal((await localStorage.uploadFromBytes("cannot-write", png)).ok, false);
  process.env.UPLOAD_STORAGE_DIR = disk;
  await rm(blocker);

  for (const backend of ["local", "replit"]) {
    process.env.STORAGE_BACKEND = backend;
    await request("/wiki/pages", "POST", { title: slug, slug }, undefined, 401);
    await request("/wiki/pages", "POST", { title: slug, slug }, stranger, 403);
    await request("/wiki/pages", "POST", { title: slug, slug }, owner, 201);
    const assetIds: number[] = [];
    for (const [contentType, bytes, fileName] of [
      ["image/png", png, "test.png"],
      ["video/mp4", video, "test.mp4"],
    ] as const) {
      const uploaded = (await request(`/wiki/pages/${slug}/assets`, "POST", {
        fileName, dataUrl: `data:${contentType};base64,${bytes.toString("base64")}`,
      }, owner, 201)).json();
      assetIds.push(uploaded.id);
      const served = await request(`/wiki/assets/${uploaded.id}`);
      assert.deepEqual(served.bytes, bytes);
      assert.equal(served.headers.get("content-type"), contentType);
      await request(`/wiki/assets/${uploaded.id}`, "DELETE", undefined, stranger, 403);
    }
    assert.equal((await request(`/wiki/pages/${slug}`)).json().assets.length, 2);
    await request(`/wiki/pages/${slug}/assets`, "POST", {
      fileName: "too-large.png",
      dataUrl: `data:image/png;base64,${Buffer.alloc(6 * 1024 * 1024 + 1).toString("base64")}`,
    }, owner, 400);
    await request(`/wiki/assets/${assetIds[0]}`, "DELETE", undefined, owner);
    await request(`/wiki/assets/${assetIds[0]}`, "GET", undefined, undefined, 404);
    await request(`/wiki/pages/${slug}`, "DELETE", undefined, owner);
    await request(`/wiki/assets/${assetIds[1]}`, "GET", undefined, undefined, 404);

    await request(site, "POST", {}, stranger, 403);
    await request(`/custom-sites/${stranger}`, "POST", {}, stranger, 403);
    await request(site, "POST", {}, owner, 201);
    await request(site, "PATCH", { active: true }, owner, 400);
    const html = Buffer.from('<!doctype html><link rel="stylesheet" href="style.css"><img src="image.png"><video src="video.mp4"></video>');
    const css = Buffer.from("body { color: green; }");
    await put("index.html", html);
    await put("style.css", css);
    await put("image.png", png);
    await put("video.mp4", video);
    await put("too-large.txt", Buffer.alloc(6 * 1024 * 1024 + 1), 413);
    await put("malformed.txt", Buffer.from("test")); // Normal input still accepted.
    await request(`${site}/file`, "PUT", { path: "invalid.txt", dataBase64: "====" }, owner, 400);
    await request(`${site}/file`, "DELETE", { path: "malformed.txt" }, owner);
    // Exercise a large *valid* base64 string without consuming the quota: it
    // must reach quota enforcement rather than throwing in input validation.
    await put("large-valid.txt", Buffer.alloc(512 * 1024), 413);
    await put("main.js", Buffer.from("alert(1)"), 403);
    await put("../escape.html", html, 400);
    await put("bad.exe", png, 415);
    await put("index.html", html, 403, stranger);
    await request(`${site}/index.html`, "GET", undefined, undefined, 404);
    await request(site, "PATCH", { active: true }, owner);
    for (const [name, bytes, type] of [
      ["index.html", html, "text/html; charset=utf-8"], ["style.css", css, "text/css; charset=utf-8"],
      ["image.png", png, "image/png"], ["video.mp4", video, "video/mp4"],
    ] as const) {
      const served = await request(`${site}/${name}`);
      assert.deepEqual(served.bytes, bytes);
      assert.equal(served.headers.get("content-type"), type);
    }
    assert.match((await request(`${site}/index.html`)).headers.get("content-security-policy")!, /script-src 'none'/);
    const oldCss = (await db.select().from(hostedSiteFilesTable).where(eq(hostedSiteFilesTable.username, owner))).find(f => f.path === "style.css")!;
    const replacement = Buffer.from("body { color: blue; }");
    await put("style.css", replacement);
    assert.deepEqual((await request(`${site}/style.css`)).bytes, replacement);
    if (backend === "local") {
      await writeFile(blocker, "test");
      process.env.UPLOAD_STORAGE_DIR = blocker;
      try {
        await put("style.css", Buffer.from("failed replacement"), 503);
      } finally {
        process.env.UPLOAD_STORAGE_DIR = disk;
        await rm(blocker);
      }
      assert.deepEqual((await request(`${site}/style.css`)).bytes, replacement, "A storage outage must not replace the existing file");
    }
    const missing = appStorage.downloadAsStream(oldCss.objectKey);
    let missingError = false;
    try { for await (const _chunk of missing) {} } catch { missingError = true; }
    assert(missingError, "Replaced object's bytes must be removed");
    const summary = (await request(site, "GET", undefined, owner)).json();
    assert.equal(summary.totalBytes, html.length + replacement.length + png.length + video.length);
    await put("full.txt", Buffer.alloc(quota - summary.totalBytes, 120));
    await put("over.txt", Buffer.from("x"), 413);
    await Promise.all([put("style.css", replacement), put("over.txt", Buffer.from("x"), 413)]);
    await request(`${site}/file`, "DELETE", { path: "full.txt" }, owner);
    await put("over.txt", Buffer.from("x"));
    await db.update(ranksTable).set({ permissions: ["editWiki", "createHtmlPage", "runHtmlPageJs"] }).where(eq(ranksTable.name, rank));
    await put("main.js", Buffer.from("document.body.dataset.test='yes'"));
    assert.match((await request(`${site}/index.html`)).headers.get("content-security-policy")!, /script-src 'self' 'unsafe-inline'/);
    await db.update(ranksTable).set({ permissions: ["editWiki"] }).where(eq(ranksTable.name, rank));
    await request(`${site}/index.html`, "GET", undefined, undefined, 404);
    await request(site, "PATCH", { active: true }, owner, 403);
    await db.update(ranksTable).set({ permissions: ["editWiki", "createHtmlPage"], siteStorageLimitBytes: 0 }).where(eq(ranksTable.name, rank));
    await put("no-quota.txt", Buffer.from("x"), 403);
    await db.update(ranksTable).set({ siteStorageLimitBytes: quota }).where(eq(ranksTable.name, rank));
    await request(site, "PATCH", { active: false }, owner);
    await request(`${site}/image.png`, "GET", undefined, undefined, 404);
    await request(site, "PATCH", { active: true }, owner);
    await request(`${site}/file`, "DELETE", { path: "index.html" }, owner);
    assert.equal((await request(site, "GET", undefined, owner)).json().active, false);
    await request(site, "DELETE", undefined, owner);
    assert.equal((await request(site, "GET", undefined, owner)).json().exists, false);
    await cleanup();
    console.log(`PASS ${backend}: wiki image/video; site HTML/CSS/media; replacement/deletion; publish/offline; ranks/JavaScript; quota/concurrency; disposable cleanup`);
  }
} finally {
  try {
    await cleanup();
    await db.delete(usersTable).where(inArray(usersTable.username, [owner, stranger]));
    await db.delete(ranksTable).where(eq(ranksTable.name, rank));
    await rm(disk, { recursive: true, force: true });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}
