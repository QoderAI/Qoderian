import { reportRestoreIssue } from '../../core/diagnostics/restore-report';
import type { VaultFileAdapter } from '../../core/storage/vault-file-adapter';
import type { SessionMetadata } from '../../core/types';
import { SESSIONS_PATH } from './storage-paths';

export { SESSIONS_PATH };

export class SessionStorage {
  constructor(private adapter: VaultFileAdapter) {}

  getMetadataPath(id: string): string {
    return `${SESSIONS_PATH}/${id}.meta.json`;
  }

  async saveMetadata(metadata: SessionMetadata): Promise<void> {
    const filePath = this.getMetadataPath(metadata.id);
    const content = JSON.stringify(metadata, null, 2);
    await this.adapter.write(filePath, content);
  }

  async loadMetadata(id: string): Promise<SessionMetadata | null> {
    try {
      const content = await this.adapter.read(this.getMetadataPath(id));
      return JSON.parse(content) as SessionMetadata;
    } catch (error) {
      reportRestoreIssue('metadata', `Failed to read session metadata "${id}": ${errorMessage(error)}`);
      return null;
    }
  }

  async deleteMetadata(id: string): Promise<void> {
    await this.adapter.delete(this.getMetadataPath(id));
  }

  async listMetadata(): Promise<SessionMetadata[]> {
    const metas: SessionMetadata[] = [];

    for (const filePath of await this.listMetadataFiles()) {
      try {
        const content = await this.adapter.read(filePath);
        metas.push(JSON.parse(content) as SessionMetadata);
      } catch (error) {
        // Skip files that fail to load, but surface the skip.
        reportRestoreIssue('metadata', `Failed to read session metadata file "${filePath}": ${errorMessage(error)}`);
      }
    }

    return metas;
  }

  private async listMetadataFiles(): Promise<string[]> {
    try {
      const files = await this.adapter.listFiles(SESSIONS_PATH);
      return files.filter((filePath) => filePath.endsWith('.meta.json'));
    } catch (error) {
      reportRestoreIssue('metadata', `Failed to list session metadata files: ${errorMessage(error)}`);
      return [];
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
