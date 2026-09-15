#!/usr/bin/env node

import { execFileSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEBUG_PORT = Number(process.env.OBSIDIAN_DEBUG_PORT || 9222);
const DEBUG_ORIGIN = `http://127.0.0.1:${DEBUG_PORT}`;
const PLUGIN_ID = 'qoderian';
const DROP_MARKER = 'QODERIAN_E2E_FILE_CONTENT_MUST_NOT_BE_PASTED';

function loadLocalEnvironment() {
  const envPath = path.join(ROOT, '.env.local');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=["']?(.+?)["']?$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

function deployPlugin(vaultPath) {
  execFileSync(process.execPath, ['scripts/build.mjs', 'production'], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', PLUGIN_ID);
  if (!existsSync(pluginDir)) {
    throw new Error(`Qoderian plugin directory does not exist: ${pluginDir}`);
  }
  for (const name of ['main.js', 'manifest.json', 'styles.css']) {
    copyFileSync(path.join(ROOT, name), path.join(pluginDir, name));
  }
}

class CdpSession {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = false) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'Renderer evaluation failed');
    }
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function retry(description, action, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await action();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`${description} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

async function findVaultTarget(vaultName) {
  const targets = await retry('Obsidian DevTools endpoint', async () => {
    const response = await fetch(`${DEBUG_ORIGIN}/json/list`);
    if (!response.ok) return null;
    return response.json();
  });
  const target = targets.find(candidate =>
    candidate.type === 'page'
    && candidate.url === 'app://obsidian.md/index.html'
    && candidate.title.includes(vaultName)
  );
  if (!target) {
    throw new Error(`No Obsidian window for vault "${vaultName}" was found on ${DEBUG_ORIGIN}`);
  }
  return target;
}

function visibleComposerStateExpression() {
  return `(() => {
    const wrapper = [...document.querySelectorAll('.qoderian-input-wrapper')]
      .find(element => element.getBoundingClientRect().width > 0);
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    return {
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2),
      sourceValue: wrapper.querySelector('textarea.qoderian-input')?.value ?? '',
      editorText: wrapper.querySelector('.cm-content')?.textContent ?? '',
    };
  })()`;
}

async function run() {
  loadLocalEnvironment();
  const vaultPath = process.env.OBSIDIAN_VAULT;
  if (!vaultPath || !existsSync(vaultPath)) {
    throw new Error('Set OBSIDIAN_VAULT in .env.local to an existing test vault.');
  }

  deployPlugin(vaultPath);

  const target = await findVaultTarget(path.basename(vaultPath));
  const cdp = new CdpSession(target.webSocketDebuggerUrl);
  await cdp.connect();

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'qoderian-file-drop-e2e-'));
  const isFolder = process.env.QODERIAN_E2E_DROP_KIND !== 'file';
  const droppedPath = path.join(tempDir, isFolder ? '外部资料 folder' : 'external-context.txt');
  if (isFolder) mkdirSync(droppedPath);
  else writeFileSync(droppedPath, DROP_MARKER, 'utf8');

  try {
    await cdp.evaluate(`(async () => {
      const plugin = app.plugins.getPlugin(${JSON.stringify(PLUGIN_ID)});
      const contexts = new Map([...(plugin?.getView()?.getTabManager()?.tabs ?? [])]
        .map(([id, tab]) => [id, tab.ui.externalContextSelector?.getExternalContexts() ?? []]));
      await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
      if (window.__qoderianE2EDragOverObserver) {
        window.removeEventListener('dragover', window.__qoderianE2EDragOverObserver, true);
      }
      if (window.__qoderianE2EHostBlocker) {
        document.removeEventListener('dragover', window.__qoderianE2EHostBlocker, true);
      }
      window.__qoderianE2EDragOverResults = [];
      window.__qoderianE2EDragOverObserver = event => {
        const reachesComposer = event.composedPath()
          .some(element => element?.classList?.contains('qoderian-input-wrapper'));
        const result = {
          accepted: false,
          reachesComposer,
          types: [...(event.dataTransfer?.types ?? [])],
          hostBlocked: false,
        };
        window.__qoderianE2EDragOverResults.push(result);
        const preventDefault = event.preventDefault.bind(event);
        event.preventDefault = () => {
          result.accepted = true;
          preventDefault();
        };
      };
      window.__qoderianE2EHostBlocker = event => {
        if (event.composedPath().some(element => element?.classList?.contains('qoderian-input-wrapper'))) {
          window.__qoderianE2EDragOverResults.push({
            accepted: event.defaultPrevented,
            reachesComposer: true,
            types: [...(event.dataTransfer?.types ?? [])],
            hostBlocked: true,
          });
          event.stopImmediatePropagation();
        }
      };
      window.addEventListener('dragover', window.__qoderianE2EDragOverObserver, true);
      await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
      await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:open-view`)});
      for (const [id, tab] of app.plugins.getPlugin(${JSON.stringify(PLUGIN_ID)}).getView().getTabManager().tabs) {
        if (contexts.has(id)) tab.ui.externalContextSelector?.setExternalContexts(contexts.get(id));
      }
      document.addEventListener('dragover', window.__qoderianE2EHostBlocker, true);
      return true;
    })()`, true);

    const before = await retry('visible Qoderian composer', () =>
      cdp.evaluate(visibleComposerStateExpression()));

    const dragData = {
      items: [{ mimeType: 'text/plain', data: DROP_MARKER }],
      files: [droppedPath],
      dragOperationsMask: 1,
    };
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp.send('Input.dispatchDragEvent', {
        type,
        x: before.x,
        y: before.y,
        data: dragData,
      });
    }

    const after = await retry('dropped file to appear as external context', async () => {
      const state = await cdp.evaluate(`(() => {
        const path = ${JSON.stringify(droppedPath)};
        const context = [...document.querySelectorAll('.qoderian-external-context-text')]
          .find(element => element.getAttribute('title') === path);
        const composer = (${visibleComposerStateExpression()});
        const notice = [...document.querySelectorAll('.notice')]
          .some(element => element.textContent.includes(path));
        const badge = context?.closest('.qoderian-external-context-selector')
          ?.querySelector('.qoderian-external-context-badge.visible');
        return context && composer && notice && badge
          ? { composer, contextTitle: context.getAttribute('title') } : null;
      })()`);
      return state;
    });

    const dragOverResults = await cdp.evaluate(
      `window.__qoderianE2EDragOverResults ?? []`,
    );
    const dragOverWasAccepted = dragOverResults.some(result => result.accepted);
    if (!dragOverWasAccepted) {
      throw new Error(
        `The window capture handler did not accept native dragover before the host intercepted it: ${JSON.stringify(dragOverResults)}`,
      );
    }

    if (after.composer.sourceValue !== before.sourceValue
        || after.composer.editorText !== before.editorText
        || after.composer.sourceValue.includes(DROP_MARKER)
        || after.composer.editorText.includes(DROP_MARKER)) {
      throw new Error('The dropped file content was inserted into the composer.');
    }

    console.log(`PASS protocol-injected ${isFolder ? 'folder' : 'file'} drop -> external context: ${after.contextTitle}`);
    console.log('PASS added path shown in a notice and context count badge');
    console.log('PASS dragover accepted before simulated host interception');
    console.log('PASS dropped file content was not pasted into the composer');
  } finally {
    try {
      await cdp.evaluate(`(() => {
        const path = ${JSON.stringify(droppedPath)};
        const text = [...document.querySelectorAll('.qoderian-external-context-text')]
          .find(element => element.getAttribute('title') === path);
        text?.closest('.qoderian-external-context-item')
          ?.querySelector('.qoderian-external-context-remove')?.click();
        if (window.__qoderianE2EDragOverObserver) {
          window.removeEventListener('dragover', window.__qoderianE2EDragOverObserver, true);
        }
        if (window.__qoderianE2EHostBlocker) {
          document.removeEventListener('dragover', window.__qoderianE2EHostBlocker, true);
        }
        delete window.__qoderianE2EDragOverObserver;
        delete window.__qoderianE2EHostBlocker;
        delete window.__qoderianE2EDragOverResults;
        return true;
      })()`);
    } catch {
      // Best-effort UI cleanup; the temporary file is always removed below.
    }
    cdp.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(`E2E FAILED: ${error.message}`);
  console.error(`Launch Obsidian with --remote-debugging-port=${DEBUG_PORT} and open the OBSIDIAN_VAULT test vault.`);
  process.exit(1);
});
