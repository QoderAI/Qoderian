export class FileContextState {
  private attachedFiles: Set<string> = new Set();
  private mentionedMcpServers: Set<string> = new Set();

  getAttachedFiles(): Set<string> {
    return new Set(this.attachedFiles);
  }

  resetForNewConversation(): void {
    this.attachedFiles.clear();
    this.clearMcpMentions();
  }

  resetForLoadedConversation(): void {
    this.attachedFiles.clear();
    this.clearMcpMentions();
  }

  setAttachedFiles(files: string[]): void {
    this.attachedFiles.clear();
    for (const file of files) {
      this.attachedFiles.add(file);
    }
  }

  attachFile(path: string): void {
    this.attachedFiles.add(path);
  }

  detachFile(path: string): void {
    this.attachedFiles.delete(path);
  }

  clearAttachments(): void {
    this.attachedFiles.clear();
  }

  getMentionedMcpServers(): Set<string> {
    return new Set(this.mentionedMcpServers);
  }

  clearMcpMentions(): void {
    this.mentionedMcpServers.clear();
  }

  setMentionedMcpServers(mentions: Set<string>): boolean {
    const changed =
      mentions.size !== this.mentionedMcpServers.size ||
      [...mentions].some(name => !this.mentionedMcpServers.has(name));

    if (changed) {
      this.mentionedMcpServers = new Set(mentions);
    }

    return changed;
  }

  addMentionedMcpServer(name: string): void {
    this.mentionedMcpServers.add(name);
  }
}
