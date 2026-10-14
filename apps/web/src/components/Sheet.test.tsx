import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sheet } from './ui';

describe('Sheet', () => {
  // UI audit G8: every sheet shows its title and a Close button, on every screen size.
  it('names the dialog by its visible title and closes from the header', async () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Set status" description="Acme · Engineer">
        <p>Body</p>
      </Sheet>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Set status' });
    expect(screen.getByRole('heading', { name: 'Set status' })).toBeVisible();
    expect(dialog).toHaveTextContent('Acme · Engineer');

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
