#!/usr/bin/env node

import {
  qodercliAuth,
  query,
} from '@qoder-ai/qoder-agent-sdk';

/** Idle async input used for initialization-only SDK operations. */
class MessageQueue {
  ended = false;
  waiter = undefined;

  end() {
    this.ended = true;
    this.waiter?.(null);
    this.waiter = undefined;
  }

  async *[Symbol.asyncIterator]() {
    while (!this.ended) {
      const message = await new Promise((resolve) => {
        this.waiter = resolve;
      });
      this.waiter = undefined;
      if (!message) return;
      yield message;
    }
  }
}

async function main() {
  const input = new MessageQueue();
  const cliPath = process.env.QODER_CLI_PATH?.trim();
  const catalogQuery = query({
    prompt: input,
    options: {
      auth: qodercliAuth(),
      cwd: process.cwd(),
      model: 'auto',
      persistSession: false,
      ...(cliPath ? { pathToQoderCLIExecutable: cliPath } : {}),
    },
  });

  try {
    const initialization = await catalogQuery.initializationResult();
    const models = await catalogQuery.getAvailableModels();
    const enabledModels = models.filter(model => model.isEnabled !== false);

    if (enabledModels.length === 0) {
      throw new Error('Qoder SDK initialized, but no enabled models were returned.');
    }

    console.log([
      'Qoder SDK smoke passed.',
      `Commands: ${initialization.commands.length}`,
      `Enabled models: ${enabledModels.length}`,
    ].join('\n'));
  } finally {
    input.end();
    await catalogQuery.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Qoder SDK smoke failed: ${message}`);
  process.exitCode = 1;
});
