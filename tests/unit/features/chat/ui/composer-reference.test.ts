import {
  type ComposerReference,
  findAtomicDeleteRange,
  findReferenceRanges,
  formatReferenceLabel,
} from '../../../../../src/features/chat/ui/composer/composer-reference';

const fileRef: ComposerReference = { token: '@notes/idea.md', path: 'notes/idea.md', kind: 'file' };
const folderRef: ComposerReference = { token: '@projects/', path: 'projects', kind: 'folder' };

describe('formatReferenceLabel', () => {
  it('uses the basename as the label', () => {
    expect(formatReferenceLabel('folder/note.md')).toBe('note.md');
  });

  it('falls back to the whole path when there is no separator', () => {
    expect(formatReferenceLabel('note.md')).toBe('note.md');
  });

  it('truncates long basenames with an ellipsis', () => {
    const longName = 'a'.repeat(30);
    expect(formatReferenceLabel(`folder/${longName}`)).toBe(`${'a'.repeat(20)}…`);
  });

  it('handles backslash paths', () => {
    expect(formatReferenceLabel('folder\\note.md')).toBe('note.md');
  });
});

describe('findReferenceRanges', () => {
  it('finds a token surrounded by whitespace', () => {
    const ranges = findReferenceRanges(`look at ${fileRef.token} please`, [fileRef]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ from: 8, to: 8 + fileRef.token.length });
  });

  it('matches a token at the start and end of the text', () => {
    const ranges = findReferenceRanges(`${fileRef.token} middle ${folderRef.token}`, [
      fileRef,
      folderRef,
    ]);
    expect(ranges.map(range => range.reference.kind)).toEqual(['file', 'folder']);
    expect(ranges[0].from).toBe(0);
    expect(ranges[1].to).toBe(fileRef.token.length + ' middle '.length + folderRef.token.length);
  });

  it('ignores a token embedded in a longer word', () => {
    const text = `xx${fileRef.token}xx`;
    expect(findReferenceRanges(text, [fileRef])).toHaveLength(0);
  });

  it('returns every standalone occurrence of a token', () => {
    const text = `${fileRef.token} and ${fileRef.token}`;
    const ranges = findReferenceRanges(text, [fileRef]);
    expect(ranges).toHaveLength(2);
    expect(ranges[1].from).toBeGreaterThan(ranges[0].to);
  });

  it('ignores tokens with no text', () => {
    expect(findReferenceRanges('anything', [{ token: '', path: '', kind: 'file' }])).toHaveLength(0);
  });
});

describe('findAtomicDeleteRange', () => {
  const text = `start ${fileRef.token} end`;

  it('backspace at the chip end removes the whole token', () => {
    const target = findAtomicDeleteRange(text, [fileRef], {
      key: 'Backspace',
      selectionFrom: 6 + fileRef.token.length,
      selectionTo: 6 + fileRef.token.length,
    });
    expect(target).toMatchObject({ from: 6, to: 6 + fileRef.token.length });
  });

  it('delete at the chip start removes the whole token', () => {
    const target = findAtomicDeleteRange(text, [fileRef], {
      key: 'Delete',
      selectionFrom: 6,
      selectionTo: 6,
    });
    expect(target).toMatchObject({ from: 6, to: 6 + fileRef.token.length });
  });

  it('returns null when the caret is away from the chip', () => {
    expect(
      findAtomicDeleteRange(text, [fileRef], { key: 'Backspace', selectionFrom: 2, selectionTo: 2 }),
    ).toBeNull();
  });

  it('removes a chip overlapping a range selection', () => {
    const target = findAtomicDeleteRange(text, [fileRef], {
      key: 'Backspace',
      selectionFrom: 8,
      selectionTo: 12,
    });
    expect(target).toMatchObject({ from: 6, to: 6 + fileRef.token.length });
  });

  it('returns null when the selection does not overlap any chip', () => {
    expect(
      findAtomicDeleteRange(text, [fileRef], { key: 'Delete', selectionFrom: 0, selectionTo: 3 }),
    ).toBeNull();
  });
});
