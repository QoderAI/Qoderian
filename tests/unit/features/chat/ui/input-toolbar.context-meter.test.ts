import { createMockEl } from '@test/helpers/mock-element';

import { ContextUsageMeter } from '@/features/chat/ui/input-toolbar';

describe('ContextUsageMeter', () => {
  it('renders a complete circular track instead of an open gauge arc', () => {
    const parentEl = createMockEl();

    new ContextUsageMeter(parentEl);

    const background = parentEl.querySelector('.qoderian-meter-bg');
    const fill = parentEl.querySelector('.qoderian-meter-fill');
    expect(background?.tagName).toBe('CIRCLE');
    expect(fill?.tagName).toBe('CIRCLE');
    expect(background?.getAttribute('cx')).toBe('9');
    expect(background?.getAttribute('cy')).toBe('9');
    expect(fill?.getAttribute('transform')).toBe('rotate(-90 9 9)');
    expect(fill?.getAttribute('d')).toBeNull();
  });
});
