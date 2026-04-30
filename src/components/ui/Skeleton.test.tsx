import { render } from '@testing-library/react';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('renders an aria-hidden div with animate-pulse class', () => {
    const { container } = render(<Skeleton className="h-4 w-12" />);
    const el = container.firstChild as HTMLElement;
    expect(el.tagName).toBe('DIV');
    expect(el).toHaveAttribute('aria-hidden');
    expect(el.className).toMatch(/animate-pulse/);
    expect(el.className).toMatch(/h-4/);
    expect(el.className).toMatch(/w-12/);
  });
});
