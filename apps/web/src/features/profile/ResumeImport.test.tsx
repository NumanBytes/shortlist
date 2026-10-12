import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithProviders } from '../../test/render';
import { ResumeImport } from './ResumeImport';

const TEXT = 'Built React dashboards used by the operations team. '.repeat(6);

describe('ResumeImport', { timeout: 20_000 }, () => {
  it('sends pasted text, then shows that the import is running', async () => {
    let started = false;
    const fetchMock = mockFetch(undefined, (url) =>
      url.endsWith('/latest')
        ? started
          ? { id: 'i1', status: 'PENDING' }
          : null
        : ((started = true), { id: 'i1', status: 'PENDING' }),
    );
    renderWithProviders(<ResumeImport />);
    await userEvent.click(await screen.findByLabelText('Resume text'));
    await userEvent.paste(TEXT);
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Reading your resume…')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ text: TEXT.trim() });
  });

  it('refuses text too short to be a resume', async () => {
    mockFetch(null);
    renderWithProviders(<ResumeImport />);
    await userEvent.type(await screen.findByLabelText('Resume text'), 'React');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.getByText(/too short for a resume/)).toBeInTheDocument());
  });
});
