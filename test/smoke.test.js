// Smoke tests: static checks that run without launching Electron.
//
// The app's real work is FFmpeg transcoding, which needs binaries, real video,
// and a display — none of which belong in CI. What these tests do cover is the
// wiring that is easy to break silently: the IPC contract between the main
// process, the preload bridge, and the renderer. Those three files must agree
// on every channel and method name, and nothing at build time enforces that.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

/** Collect every capture-group-1 match of `re` in `src` as a Set. */
function matchAll(src, re) {
  return new Set(Array.from(src.matchAll(re), (m) => m[1]));
}

const mainSrc = read("main.js");
const preloadSrc = read("preload.js");
const rendererSrc = read("renderer.js");

const SOURCE_FILES = ["main.js", "preload.js", "renderer.js", "converter.js"];

test("every source file parses", () => {
  for (const file of SOURCE_FILES) {
    assert.doesNotThrow(
      () => execFileSync(process.execPath, ["--check", path.join(ROOT, file)]),
      `${file} has a syntax error`,
    );
  }
});

test("package.json entry point exists", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(
    fs.existsSync(path.join(ROOT, pkg.main)),
    `package.json main "${pkg.main}" does not exist`,
  );
});

test("converter exposes its two entry points", () => {
  const converter = require(path.join(ROOT, "converter.js"));
  assert.equal(typeof converter.convertMovToMp4, "function");
  assert.equal(typeof converter.combineMovToMp4, "function");
});

test("main-to-renderer channels are all bridged by preload", () => {
  // Main sends through the sendToRenderer() guard rather than calling
  // webContents.send() directly; see the guarded-sender test below.
  const sent = matchAll(mainSrc, /sendToRenderer\(\s*"([\w-]+)"/g);
  const bridged = matchAll(preloadSrc, /ipcRenderer\.on\(\s*"([\w-]+)"/g);

  assert.ok(sent.size > 0, "found no sendToRenderer calls — regex is stale");
  for (const channel of sent) {
    assert.ok(
      bridged.has(channel),
      `main.js sends "${channel}" but preload.js never listens for it`,
    );
  }
});

test("renderer-to-main channels are all handled by main", () => {
  const requested = matchAll(
    preloadSrc,
    /ipcRenderer\.(?:invoke|send)\(\s*"([\w-]+)"/g,
  );
  const handled = matchAll(mainSrc, /ipcMain\.(?:handle|on)\(\s*"([\w-]+)"/g);

  assert.ok(requested.size > 0, "found no ipcRenderer calls — regex is stale");
  for (const channel of requested) {
    assert.ok(
      handled.has(channel),
      `preload.js calls "${channel}" but main.js never handles it`,
    );
  }
});

test("every window.electron method the renderer uses is exposed by preload", () => {
  // Top-level keys of the object passed to exposeInMainWorld, which are
  // indented exactly two spaces in this file.
  const exposed = matchAll(preloadSrc, /^ {2}(\w+):/gm);
  const used = matchAll(rendererSrc, /window\.electron\.(\w+)/g);

  assert.ok(exposed.size > 0, "parsed no preload exports — regex is stale");
  for (const method of used) {
    assert.ok(
      exposed.has(method),
      `renderer.js calls window.electron.${method}(), which preload.js does not expose`,
    );
  }
});

test("all renderer messaging goes through the guarded sender", () => {
  // The window can be closed while FFmpeg is still encoding — on macOS the app
  // survives that — so a raw mainWindow.webContents.send() throws on null.
  // sendToRenderer() is the only place allowed to touch webContents directly.
  const sends = mainSrc.match(/webContents\.send\(/g) ?? [];
  assert.equal(
    sends.length,
    1,
    `main.js should call webContents.send() exactly once, inside sendToRenderer(); found ${sends.length}`,
  );

  const helper = mainSrc.match(
    /function sendToRenderer\([^)]*\)\s*\{[\s\S]*?\n\}/,
  );
  assert.ok(helper, "main.js no longer defines sendToRenderer()");
  assert.match(
    helper[0],
    /webContents\.send\(/,
    "the single webContents.send() call is not the one inside sendToRenderer()",
  );
  assert.match(
    helper[0],
    /if \(!mainWindow \|\| mainWindow\.isDestroyed\(\)\) return;/,
    "sendToRenderer() lost its null/destroyed guard",
  );
});

test("US spelling is used for canceled", () => {
  // The codebase already uses Electron's US-spelled `result.canceled`; this
  // keeps our own identifiers and status strings from drifting back.
  for (const file of SOURCE_FILES) {
    assert.doesNotMatch(
      read(file),
      /cancelled/i,
      `${file} uses the British spelling "cancelled" — prefer "canceled"`,
    );
  }
});
