import { Notice } from 'obsidian';
import * as path from 'path';

import type { ImageAttachment, ImageMediaType } from '../../../core/types';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, ImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** Maps supported image filenames to their media types. */
export function imageMediaTypeForFilename(filename: string): ImageMediaType | null {
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS[ext] || null;
}

export interface ImageContextCallbacks {
  onImagesChanged: () => void;
}

export class ImageContextManager {
  private callbacks: ImageContextCallbacks;
  private containerEl: HTMLElement;
  private previewContainerEl: HTMLElement;
  private imagePreviewEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private dropOverlay: HTMLElement | null = null;
  private attachedImages: Map<string, ImageAttachment> = new Map();
  private enabled = true;

  constructor(
    containerEl: HTMLElement,
    inputEl: HTMLTextAreaElement,
    callbacks: ImageContextCallbacks,
    previewContainerEl?: HTMLElement
  ) {
    this.containerEl = containerEl;
    this.previewContainerEl = previewContainerEl ?? containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;

    // Create image preview in previewContainerEl, before file indicator if present
    const fileIndicator = this.previewContainerEl.querySelector('.qoderian-file-indicator');
    this.imagePreviewEl = this.previewContainerEl.createDiv({ cls: 'qoderian-image-preview' });
    if (fileIndicator && fileIndicator.parentElement === this.previewContainerEl) {
      this.previewContainerEl.insertBefore(this.imagePreviewEl, fileIndicator);
    }

    this.setupDragAndDrop();
    this.setupPasteHandler();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.attachedImages.size > 0) {
      this.clearImages();
    }
  }

  getAttachedImages(): ImageAttachment[] {
    return Array.from(this.attachedImages.values());
  }

  hasImages(): boolean {
    return this.attachedImages.size > 0;
  }

  clearImages() {
    this.attachedImages.clear();
    this.updateImagePreview();
    this.callbacks.onImagesChanged();
  }

  /** Sets images directly (used for queued messages). */
  setImages(images: ImageAttachment[]) {
    this.attachedImages.clear();
    for (const image of images) {
      this.attachedImages.set(image.id, image);
    }
    this.updateImagePreview();
    this.callbacks.onImagesChanged();
  }

  private setupDragAndDrop() {
    const inputWrapper = this.containerEl.querySelector('.qoderian-input-wrapper') as HTMLElement;
    if (!inputWrapper) return;

    this.dropOverlay = inputWrapper.createDiv({ cls: 'qoderian-drop-overlay' });
    const dropContent = this.dropOverlay.createDiv({ cls: 'qoderian-drop-content' });
    const svg = dropContent.createSvg('svg', {
      attr: {
        viewBox: '0 0 24 24',
        width: '32',
        height: '32',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
      },
    });
    svg.createSvg('path', { attr: { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' } });
    svg.createSvg('polyline', { attr: { points: '17 8 12 3 7 8' } });
    svg.createSvg('line', { attr: { x1: '12', y1: '3', x2: '12', y2: '15' } });
    dropContent.createSpan({ text: 'Drop image here' });

    const dropZone = inputWrapper;

    dropZone.addEventListener('dragenter', (e) => this.handleDragEnter(e));
    dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
    dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
    dropZone.addEventListener('drop', (e) => {
      void this.handleDrop(e);
    });
  }

  private handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer?.types.includes('Files')) {
      this.dropOverlay?.addClass('visible');
    }
  }

  private handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  private handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    const inputWrapper = this.containerEl.querySelector('.qoderian-input-wrapper');
    if (!inputWrapper) {
      this.dropOverlay?.removeClass('visible');
      return;
    }

    const rect = inputWrapper.getBoundingClientRect();
    if (
      e.clientX <= rect.left ||
      e.clientX >= rect.right ||
      e.clientY <= rect.top ||
      e.clientY >= rect.bottom
    ) {
      this.dropOverlay?.removeClass('visible');
    }
  }

  private async handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dropOverlay?.removeClass('visible');

    const files = e.dataTransfer?.files;
    if (!files) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (this.isImageFile(file)) {
        await this.addImageFromFile(file, 'drop');
      }
    }
  }

  private setupPasteHandler() {
    this.inputEl.addEventListener('paste', (e) => {
      void (async (): Promise<void> => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            await this.addImageFromFile(file, 'paste');
          }
          return;
        }
      }
      })();
    });
  }

  private isImageFile(file: File): boolean {
    return file.type.startsWith('image/') && imageMediaTypeForFilename(file.name) !== null;
  }

  /**
   * Attaches an image from raw bytes (vault drags). Mirrors the paste
   * pipeline so dropped vault images preview and send like pasted ones.
   */
  async attachImageBuffer(
    name: string,
    mediaType: ImageMediaType,
    buffer: ArrayBuffer,
    source: 'paste' | 'drop' = 'drop',
  ): Promise<boolean> {
    if (!this.enabled) {
      new Notice('Image attachments are not supported by this Qoder runtime.');
      return false;
    }

    if (buffer.byteLength > MAX_IMAGE_SIZE) {
      this.notifyImageError(`Image exceeds ${this.formatSize(MAX_IMAGE_SIZE)} limit.`);
      return false;
    }

    try {
      const base64 = Buffer.from(buffer).toString('base64');

      const attachment: ImageAttachment = {
        id: this.generateId(),
        name: name || `image-${Date.now()}.${mediaType.split('/')[1]}`,
        mediaType,
        data: base64,
        size: buffer.byteLength,
        source,
      };

      this.attachedImages.set(attachment.id, attachment);
      this.updateImagePreview();
      this.callbacks.onImagesChanged();
      return true;
    } catch (error) {
      this.notifyImageError('Failed to attach image.', error);
      return false;
    }
  }

  private async addImageFromFile(file: File, source: 'paste' | 'drop'): Promise<boolean> {
    const mediaType = imageMediaTypeForFilename(file.name) || (file.type as ImageMediaType);
    if (!mediaType) {
      this.notifyImageError('Unsupported image type.');
      return false;
    }

    try {
      return await this.attachImageBuffer(file.name, mediaType, await file.arrayBuffer(), source);
    } catch (error) {
      this.notifyImageError('Failed to attach image.', error);
      return false;
    }
  }

  // ============================================
  // Private: Image Preview
  // ============================================

  private updateImagePreview() {
    this.imagePreviewEl.empty();

    if (this.attachedImages.size === 0) {
      this.imagePreviewEl.removeClass('qoderian-visible-flex');
      this.imagePreviewEl.addClass('qoderian-hidden');
      return;
    }

    this.imagePreviewEl.addClass('qoderian-visible-flex');
    this.imagePreviewEl.removeClass('qoderian-hidden');

    for (const [id, image] of this.attachedImages) {
      this.renderImagePreview(id, image);
    }
  }

  private renderImagePreview(id: string, image: ImageAttachment) {
    const previewEl = this.imagePreviewEl.createDiv({ cls: 'qoderian-image-chip' });

    const thumbEl = previewEl.createDiv({ cls: 'qoderian-image-thumb' });
    thumbEl.createEl('img', {
      attr: {
        src: `data:${image.mediaType};base64,${image.data}`,
        alt: image.name,
      },
    });

    const infoEl = previewEl.createDiv({ cls: 'qoderian-image-info' });
    const nameEl = infoEl.createSpan({ cls: 'qoderian-image-name' });
    nameEl.setText(this.truncateName(image.name, 20));
    nameEl.setAttribute('title', image.name);

    const sizeEl = infoEl.createSpan({ cls: 'qoderian-image-size' });
    sizeEl.setText(this.formatSize(image.size));

    const removeEl = previewEl.createSpan({ cls: 'qoderian-image-remove' });
    removeEl.setText('\u00D7');
    removeEl.setAttribute('aria-label', 'Remove image');

    removeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.attachedImages.delete(id);
      this.updateImagePreview();
      this.callbacks.onImagesChanged();
    });

    thumbEl.addEventListener('click', () => {
      this.showFullImage(image);
    });
  }

  private showFullImage(image: ImageAttachment) {
    const ownerDocument = this.containerEl.ownerDocument ?? window.document;
    const overlay = ownerDocument.body.createDiv({ cls: 'qoderian-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'qoderian-image-modal' });

    modal.createEl('img', {
      attr: {
        src: `data:${image.mediaType};base64,${image.data}`,
        alt: image.name,
      },
    });

    const closeBtn = modal.createDiv({ cls: 'qoderian-image-modal-close' });
    closeBtn.setText('\u00D7');

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };

    const close = () => {
      ownerDocument.removeEventListener('keydown', handleEsc);
      overlay.remove();
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    ownerDocument.addEventListener('keydown', handleEsc);
  }

  private generateId(): string {
    return `img-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private truncateName(name: string, maxLen: number): string {
    if (name.length <= maxLen) return name;
    const ext = path.extname(name);
    const base = name.slice(0, name.length - ext.length);
    const truncatedBase = base.slice(0, maxLen - ext.length - 3);
    return `${truncatedBase}...${ext}`;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private notifyImageError(message: string, error?: unknown) {
    let userMessage = message;
    if (error instanceof Error) {
      if (error.message.includes('ENOENT') || error.message.includes('no such file')) {
        userMessage = `${message} (File not found)`;
      } else if (error.message.includes('EACCES') || error.message.includes('permission denied')) {
        userMessage = `${message} (Permission denied)`;
      }
    }
    new Notice(userMessage);
  }
}
