/**
 * Qoderian dev reloader — development-only helper plugin.
 *
 * Watches the installed Qoderian plugin folder and reloads Qoderian whenever
 * `npm run dev` copies a fresh build in. Installed into the vault referenced by
 * OBSIDIAN_VAULT by esbuild.config.mjs; never shipped with Qoderian itself.
 */

const { Notice, Plugin } = require('obsidian');
const fs = require('fs');
const path = require('path');

const TARGET_PLUGIN_ID = 'qoderian';

// data.json is deliberately excluded: Qoderian writes it while unloading, which
// would otherwise make every reload trigger another reload.
const WATCHED_ARTIFACTS = ['main.js', 'manifest.json', 'styles.css'];

// Long enough for esbuild to finish copying all three artifacts, short enough to
// still feel immediate.
const RELOAD_DEBOUNCE_MS = 400;

module.exports = class QoderianDevReloader extends Plugin {
  onload() {
    const targetDir = this.resolveTargetPluginDir();
    if (!fs.existsSync(targetDir)) {
      new Notice(`Dev reloader: ${TARGET_PLUGIN_ID} is not installed in this vault.`);
      return;
    }

    this.reloadTimer = null;
    this.watcher = fs.watch(targetDir, (_eventType, filename) => {
      if (!filename || !WATCHED_ARTIFACTS.includes(path.basename(filename))) return;
      this.scheduleReload();
    });

    this.register(() => this.watcher?.close());
    this.register(() => window.clearTimeout(this.reloadTimer));
  }

  resolveTargetPluginDir() {
    const basePath = this.app.vault.adapter.getBasePath();
    return path.join(basePath, this.app.vault.configDir, 'plugins', TARGET_PLUGIN_ID);
  }

  scheduleReload() {
    window.clearTimeout(this.reloadTimer);
    this.reloadTimer = window.setTimeout(() => {
      void this.reloadTarget();
    }, RELOAD_DEBOUNCE_MS);
  }

  async reloadTarget() {
    const plugins = this.app.plugins;

    // Respect a manually disabled target instead of force-enabling it.
    if (!plugins.enabledPlugins.has(TARGET_PLUGIN_ID)) return;

    try {
      await plugins.disablePlugin(TARGET_PLUGIN_ID);
      await plugins.enablePlugin(TARGET_PLUGIN_ID);
      new Notice('Qoderian reloaded');
    } catch (error) {
      new Notice(`Qoderian reload failed: ${error?.message ?? error}`);
    }
  }
};
