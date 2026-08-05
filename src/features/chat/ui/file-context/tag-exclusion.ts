function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').replace(/\/+$/, '').toLowerCase();
}

/** Returns true when a note tag is excluded directly or by an excluded parent tag. */
export function isTagExcluded(noteTag: string, excludedTags: string[]): boolean {
  const normalizedNoteTag = normalizeTag(noteTag);
  if (!normalizedNoteTag) return false;

  return excludedTags.some((excludedTag) => {
    const normalizedExcludedTag = normalizeTag(excludedTag);
    if (!normalizedExcludedTag) return false;

    return normalizedNoteTag === normalizedExcludedTag
      || normalizedNoteTag.startsWith(`${normalizedExcludedTag}/`);
  });
}
