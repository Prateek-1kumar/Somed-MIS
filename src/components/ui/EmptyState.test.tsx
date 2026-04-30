import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders title, description, icon, and optional action', () => {
    render(
      <EmptyState
        icon={<span data-testid="ic">!</span>}
        title="No data"
        description="Try adjusting your filters."
        action={<button>Reset</button>}
      />,
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.getByText('Try adjusting your filters.')).toBeInTheDocument();
    expect(screen.getByTestId('ic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });

  it('renders without an action when none provided', () => {
    render(<EmptyState icon={<span>!</span>} title="Empty" description="x" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
