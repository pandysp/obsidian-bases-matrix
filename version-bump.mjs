/**
 * Sync the plugin version across manifest.json and versions.json after an
 * `npm version` bump. Standard pattern from obsidian-sample-plugin.
 *
 * `npm version` bumps package.json first; this script reads the new version
 * from there, propagates it to manifest.json (so Obsidian sees it), and
 * adds a versions.json entry mapping it to the minimum app version (so the
 * community-plugin store knows which Obsidian versions support this release).
 */
import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  console.error("npm_package_version not set — run via `npm version` or `npm run version`.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "  ") + "\n");

console.log(`Bumped to ${targetVersion} (minAppVersion ${minAppVersion}).`);
