import { STARTER_DISCOVERY_PREFERENCES } from '@shortlist/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithProviders } from '../../test/render';
import { SearchSettingsForm } from './SearchSettingsForm';

describe('SearchSettingsForm', { timeout: 20_000 }, () => {
  it('saves comma-separated terms as lists, lowercased', async () => {
    const fetchMock = mockFetch({ preferences: STARTER_DISCOVERY_PREFERENCES, isDefault: false });
    const done = vi.fn();
    renderWithProviders(<SearchSettingsForm initial={STARTER_DISCOVERY_PREFERENCES} onDone={done} />);
    await userEvent.type(screen.getByLabelText('Job titles'), 'Frontend, React Developer');
    await userEvent.type(screen.getByLabelText('Your stack'), 'React,TypeScript');
    await userEvent.type(screen.getByLabelText('On-site or hybrid in'), 'Karachi');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/discovery/preferences');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init!.body as string)).toMatchObject({
      titleInclude: ['frontend', 'react developer'],
      stackKeywords: ['react', 'typescript'],
      onsiteLocations: ['karachi'],
      roleTitleTerms: ['software', 'developer', 'engineer', 'frontend', 'react developer'],
    });
  });

  it('asks for at least one title before saving', async () => {
    const fetchMock = mockFetch({});
    renderWithProviders(<SearchSettingsForm initial={STARTER_DISCOVERY_PREFERENCES} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/at least one word a job title/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/discovery/preferences', expect.anything());
  });
});
