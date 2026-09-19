import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketingMessageComposer } from './MarketingMessageComposer';

const fetchMock = vi.fn();

vi.mock('@/components/admin/LusterClientSms', () => ({
  LusterClientSms: (props: { clientId: string; composerTitle: string; initialDraft: string; purpose?: string }) => (
    <div data-testid="shared-composer" data-client-id={props.clientId} data-purpose={props.purpose}>
      <span>{props.composerTitle}</span>
      <span>{props.initialDraft}</span>
    </div>
  ),
}));

describe('MarketingMessageComposer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      const data = url.startsWith('/api/admin/review-requests/settings')
        ? {
            googleReviewUrl: 'https://g.page/isla/review',
            messageTemplate: 'Hi {{firstName}}, would you review {{businessName}}? {{reviewLink}}',
            businessName: 'Isla Nails',
          }
        : {
            clients: [
              { id: 'client-1', fullName: 'Ava Lee', phone: '4165550101' },
              { id: 'client-2', fullName: 'Jessica Cruz', phone: '4165550102' },
            ],
          };
      return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
    });
  });

  it('lets the owner choose a client and opens a blank contextual composer', async () => {
    render(<MarketingMessageComposer salonSlug="isla" salonName="Isla Nails" googleReviewUrl="https://g.page/isla/review" />);

    fireEvent.click(await screen.findByRole('button', { name: /Ava Lee/ }));

    expect(screen.getByTestId('shared-composer')).toHaveAttribute('data-client-id', 'client-1');
    expect(screen.getByText('Text Ava Lee')).toBeVisible();
  });

  it('prefills the known client and review link for a Google review message', async () => {
    render(<MarketingMessageComposer salonSlug="isla" salonName="Isla Nails" googleReviewUrl="https://g.page/isla/review" />);

    fireEvent.click(screen.getByRole('button', { name: 'Google review' }));
    fireEvent.click(await screen.findByRole('button', { name: /Jessica Cruz/ }));

    expect(screen.getByText('Send Google review link')).toBeVisible();
    expect(screen.getByText(/Hi Jessica/)).toHaveTextContent('would you review Isla Nails? https://g.page/isla/review');
    expect(screen.getByTestId('shared-composer')).toHaveAttribute('data-purpose', 'google_review');
  });

  it('filters clients without refetching or losing the selected message type', async () => {
    render(<MarketingMessageComposer salonSlug="isla" salonName="Isla Nails" googleReviewUrl="https://g.page/isla/review" />);
    await screen.findByRole('button', { name: /Jessica Cruz/ });
    const initialRequestCount = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Google review' }));
    fireEvent.change(screen.getByLabelText('Choose a client'), { target: { value: 'Jessica' } });

    expect(screen.queryByRole('button', { name: /Ava Lee/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Jessica Cruz/ })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(initialRequestCount);
  });
});
