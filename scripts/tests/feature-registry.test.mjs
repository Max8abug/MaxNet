import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const parse = (text) => ts.createSourceFile("source.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function nodes(node, predicate) {
  const found = [];
  function visit(child) {
    if (predicate(child)) found.push(child);
    ts.forEachChild(child, visit);
  }
  visit(node);
  return found;
}
function property(object, name) {
  return object.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === name)?.initializer;
}
const literal = (node) => node && ts.isStringLiteral(node) ? node.text : undefined;
const registryPath = "lib/feature-registry/src/index.ts";
const registrySource = read(registryPath);
// Execute only this dependency-free module, without loading a database, UI,
// application server, environment variables, or generated app bundles.
async function loadRegistry(source) {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const registry = await loadRegistry(registrySource);
const { ARCHIVABLE_FEATURES, PROTECTED_LAUNCHER_IDS, isArchivableFeatureId, cleanArchivedFeatures } = registry;
const featureIds = new Set(ARCHIVABLE_FEATURES.map((f) => f.id));
const protectedIds = new Set(PROTECTED_LAUNCHER_IDS);
const desktop = parse(read("artifacts/photo-desktop/src/components/Taskbar.tsx"));
const mobile = parse(read("artifacts/photo-desktop/src/components/MobileShell.tsx"));
const functions = new Map(nodes(desktop, ts.isFunctionDeclaration).filter((n) => n.name).map((n) => [n.name.text, n]));

function launchTypes(action) {
  const types = new Set();
  const seen = new Set();
  function inspect(node) {
    for (const prop of nodes(node, ts.isPropertyAssignment)) {
      if (prop.name.getText() === "type" && literal(prop.initializer)) types.add(literal(prop.initializer));
    }
    // Resolve named handlers (Planner, Chat, Playlists), not just inline open().
    for (const id of nodes(node, ts.isIdentifier)) {
      const fn = functions.get(id.text);
      if (fn && !seen.has(id.text)) {
        seen.add(id.text);
        inspect(fn.body);
      }
    }
  }
  inspect(action);
  return [...types];
}
function checkDesktopEntry(entry) {
  const feature = literal(property(entry, "feature"));
  const protectedEntry = property(entry, "protected")?.kind === ts.SyntaxKind.TrueKeyword;
  const types = launchTypes(property(entry, "act"));
  if (feature) {
    assert.ok(featureIds.has(feature), `Unregistered desktop feature: ${feature}`);
    assert.equal(protectedEntry, false, `${feature} cannot also be protected`);
    assert.deepEqual(types, [feature], `Desktop archive ID does not match launch target: ${feature}`);
  } else {
    assert.ok(protectedEntry, "Desktop entry is missing archive metadata");
    for (const type of types) assert.ok(protectedIds.has(type), `Public launcher incorrectly protected: ${type}`);
    if (types.length === 0) {
      // Explicit non-window actions; don't let a new window silently bypass the check.
      const calls = nodes(property(entry, "act"), ts.isCallExpression).map((n) => n.expression.getText());
      assert.ok(calls.some((name) => name === "resetState" || name === "turnOnNotifications"), "Unknown protected action");
    }
  }
  return feature;
}
function checkMobileEntry(entry) {
  const type = literal(property(entry, "type"));
  assert.ok(featureIds.has(type) || protectedIds.has(type), `Unclassified mobile launcher: ${type}`);
  return type;
}

test("registry stays browser-safe and contains unique, valid presentation metadata", () => {
  assert.equal(nodes(parse(registrySource), ts.isImportDeclaration).length, 0);
  assert.equal(nodes(parse(registrySource), ts.isCallExpression).filter((n) => n.expression.getText() === "require").length, 0);
  const manifest = JSON.parse(read("lib/feature-registry/package.json"));
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.equal(featureIds.size, ARCHIVABLE_FEATURES.length);
  assert.equal(protectedIds.size, PROTECTED_LAUNCHER_IDS.length);
  for (const feature of ARCHIVABLE_FEATURES) {
    assert.ok(feature.name.trim());
    assert.ok(["Info", "Games", "Social", "Tools"].includes(feature.category));
    assert.equal(protectedIds.has(feature.id), false);
  }
});

test("validation accepts every registry ID and rejects protected, unknown, and malformed values", () => {
  for (const id of featureIds) assert.equal(isArchivableFeatureId(id), true);
  for (const id of [...protectedIds, "photo", "gallery", "userpage", "__proto__", "constructor", "unknown", "", null, 1, {}]) {
    assert.equal(isArchivableFeatureId(id), false);
  }
  assert.deepEqual(cleanArchivedFeatures(["planner", null, "settings", "planner", "unknown", "text", 3]), ["planner", "text"]);
  for (const invalid of [null, {}, "planner", 1]) assert.deepEqual(cleanArchivedFeatures(invalid), []);
});

test("desktop category entries and pushed administration actions have matching archive metadata", () => {
  const entries = nodes(desktop, ts.isObjectLiteralExpression).filter((n) => property(n, "label") && property(n, "act"));
  assert.ok(entries.length > 0);
  const covered = new Set(entries.map(checkDesktopEntry).filter(Boolean));
  assert.deepEqual(covered, featureIds, "Every registered feature must have a desktop launch entry");
});

test("mobile launcher entries are classified and cover the registry", () => {
  const apps = nodes(mobile, ts.isVariableDeclaration).find((n) => n.name.getText() === "APPS");
  assert.ok(apps && ts.isArrayLiteralExpression(apps.initializer));
  const covered = new Set(apps.initializer.elements.map(checkMobileEntry).filter((id) => featureIds.has(id)));
  assert.deepEqual(covered, featureIds, "Every registered feature must have a mobile web launch entry");
});

test("pinned desktop window shortcuts have archive guards matching their launch targets", () => {
  // Scope is the Start menu, not taskbar presence chips, notification actions,
  // or controls for restoring already-open windows.
  const startMenu = nodes(desktop, ts.isBinaryExpression).find((n) =>
    n.left.getText() === "startOpen" && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken);
  assert.ok(startMenu);
  const buttons = nodes(startMenu.right, ts.isJsxElement).filter((n) => n.openingElement.tagName.getText() === "button");
  let checked = 0;
  for (const button of buttons) {
    const click = button.openingElement.attributes.properties.find((n) => n.name?.getText() === "onClick");
    if (!click?.initializer || !ts.isJsxExpression(click.initializer) || !click.initializer.expression) continue;
    const types = launchTypes(click.initializer.expression);
    if (!types.length) continue;
    const guard = button.parent;
    assert.ok(ts.isBinaryExpression(guard) && guard.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken,
      `Pinned window launcher is missing its archive guard: ${click.getText()} (${types.join(", ")})`);
    for (const type of types) {
      assert.ok(featureIds.has(type));
      assert.equal(guard.left.getText(), `!archivedFeatures.has("${type}")`);
    }
    checked++;
  }
  assert.ok(checked >= 2);
});

test("drift detectors reject forgotten registry entries, missing metadata, mismatches, and protected public features", () => {
  const object = (source) => nodes(parse(`const item = ${source}`), ts.isObjectLiteralExpression)[0];
  assert.throws(() => checkMobileEntry(object(`{ type: "futurefeature" }`)), /Unclassified/);
  assert.throws(() => checkDesktopEntry(object(`{ label: "New", act: () => open({ type: "planner" }) }`)), /missing archive metadata/);
  assert.throws(() => checkDesktopEntry(object(`{ feature: "futurefeature", act: () => open({ type: "futurefeature" }) }`)), /Unregistered/);
  assert.throws(() => checkDesktopEntry(object(`{ feature: "news", act: () => open({ type: "planner" }) }`)), /does not match/);
  assert.throws(() => checkDesktopEntry(object(`{ protected: true, act: () => open({ type: "planner" }) }`)), /incorrectly protected/);
});

test("saved WindowType IDs remain intact and every window type has an explicit classification", () => {
  const store = parse(read("artifacts/photo-desktop/src/store.ts"));
  const windowType = nodes(store, ts.isTypeAliasDeclaration).find((n) => n.name.text === "WindowType");
  const ids = new Set(nodes(windowType, ts.isStringLiteral).map((n) => n.text));
  const savedIds = "photo gallery text link youtube drawing chat visits guestbook sharedphotos forum blackjack flappy geometry poker music polls chess eaglercraft cafe dms browser userpage ranksadmin userlist mypage settings sitesettings iplookup news diagnostics sitebackup accountadmin planner personalplaylists featurearchive themelab".split(" ");
  for (const id of savedIds) assert.ok(ids.has(id), `Persisted WindowType ID removed: ${id}`);
  for (const id of "settings ranksadmin accountadmin sitesettings featurearchive themelab sitebackup diagnostics iplookup".split(" ")) {
    assert.ok(protectedIds.has(id), `Administration/settings protection removed: ${id}`);
    assert.equal(featureIds.has(id), false);
  }
  // Contextual windows are opened from content, not either site launcher.
  const contextualIds = new Set(["photo", "gallery", "userpage"]);
  assert.deepEqual(ids, new Set([...featureIds, ...protectedIds, ...contextualIds]));
});

test("panel and server consume the same registry, including a newly registered feature", async () => {
  const catalog = read("artifacts/photo-desktop/src/lib/feature-catalog.ts");
  assert.match(catalog, /export \{ ARCHIVABLE_FEATURES as FEATURE_CATALOG \} from "@workspace\/feature-registry"/);
  const server = read("artifacts/api-server/src/routes/site-settings.ts");
  assert.match(server, /import \{ cleanArchivedFeatures, isArchivableFeatureId \} from "@workspace\/feature-registry"/);
  assert.match(server, /if \(!isArchivableFeatureId\(featureId\) \|\| typeof req.body\?\.archived !== "boolean"\)/);
  const extended = await loadRegistry(registrySource.replace(
    "export const ARCHIVABLE_FEATURES = [",
    'export const ARCHIVABLE_FEATURES = [\n { id: "futurefeature", name: "Future Feature", category: "Tools" },',
  ));
  assert.ok(extended.ARCHIVABLE_FEATURES.some((f) => f.id === "futurefeature"));
  assert.equal(extended.isArchivableFeatureId("futurefeature"), true);
  assert.deepEqual(extended.cleanArchivedFeatures(["futurefeature"]), ["futurefeature"]);
});
