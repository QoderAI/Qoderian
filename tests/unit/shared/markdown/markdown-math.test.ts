import {
  escapeMathDelimitersForStreaming,
  hasStreamingMathDelimiters,
  normalizeMathDelimitersForObsidian,
} from '@/shared/markdown/markdown-math';

describe('markdownMath', () => {
  describe('normalizeMathDelimitersForObsidian', () => {
    it('converts inline and multiline display LaTeX delimiters', () => {
      const markdown = [
        'Inline \\(x + y\\).',
        '\\[',
        '\\operatorname{Attention}(Q,K,V)',
        '\\]',
      ].join('\n');

      expect(normalizeMathDelimitersForObsidian(markdown)).toBe([
        'Inline $x + y$.',
        '$$',
        '\\operatorname{Attention}(Q,K,V)',
        '$$',
      ].join('\n'));
    });

    it('preserves delimiters in inline code, fenced code, and HTML attributes', () => {
      const markdown = [
        'Text \\(x\\)',
        '`literal \\(inline\\)`',
        '```tex',
        '\\[fenced\\]',
        '```',
        '<span title="\\(attribute\\)">value \\(y\\)</span>',
      ].join('\n');

      expect(normalizeMathDelimitersForObsidian(markdown)).toBe([
        'Text $x$',
        '`literal \\(inline\\)`',
        '```tex',
        '\\[fenced\\]',
        '```',
        '<span title="\\(attribute\\)">value $y$</span>',
      ].join('\n'));
    });

    it('preserves delimiters whose backslash is escaped', () => {
      expect(normalizeMathDelimitersForObsidian('Literal \\\\(x\\\\).')).toBe(
        'Literal \\\\(x\\\\).',
      );
    });
  });

  describe('escapeMathDelimitersForStreaming', () => {
    it('escapes inline and display math delimiters outside code', () => {
      expect(escapeMathDelimitersForStreaming('Use $x + y$ and $$z^2$$.')).toBe(
        'Use \\$x + y\\$ and \\$\\$z^2\\$\\$.'
      );
    });

    it('preserves inline code and fenced code dollars', () => {
      const markdown = [
        'Text $x$',
        '`echo $PATH`',
        '```bash',
        'echo "$HOME"',
        '```',
        'Done $$y$$',
      ].join('\n');

      expect(escapeMathDelimitersForStreaming(markdown)).toBe([
        'Text \\$x\\$',
        '`echo $PATH`',
        '```bash',
        'echo "$HOME"',
        '```',
        'Done \\$\\$y\\$\\$',
      ].join('\n'));
    });

    it('keeps already escaped dollars unchanged', () => {
      expect(escapeMathDelimitersForStreaming('Cost is \\$5, math is $x$.')).toBe(
        'Cost is \\$5, math is \\$x\\$.'
      );
    });

    it('does not alter dollars inside raw html tag attributes', () => {
      expect(escapeMathDelimitersForStreaming('<span title="$x$">value $y$</span>')).toBe(
        '<span title="$x$">value \\$y\\$</span>'
      );
    });

    it('normalizes backslash math delimiters before escaping them', () => {
      expect(escapeMathDelimitersForStreaming('Use \\(x\\) and \\[y\\].')).toBe(
        'Use \\$x\\$ and \\$\\$y\\$\\$.',
      );
    });
  });

  describe('hasStreamingMathDelimiters', () => {
    it('detects unescaped dollars outside code', () => {
      expect(hasStreamingMathDelimiters('math $x$')).toBe(true);
      expect(hasStreamingMathDelimiters('math \\(x\\)')).toBe(true);
      expect(hasStreamingMathDelimiters('math \\[x\\]')).toBe(true);
      expect(hasStreamingMathDelimiters('`echo $PATH`')).toBe(false);
      expect(hasStreamingMathDelimiters('`literal \\(x\\)`')).toBe(false);
      expect(hasStreamingMathDelimiters('\\$5')).toBe(false);
    });
  });
});
