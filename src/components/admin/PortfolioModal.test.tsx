import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PortfolioModal } from './PortfolioModal';

const fetchMock = vi.fn();

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({ salonSlug: 'salon-a' }),
}));

const portfolioPayload = {
  usage: { stored: 1, max: 10, remaining: 9, overAllowance: false, plan: 'pro', source: 'plan' },
  readiness: {
    discoverEligiblePhotos: 1,
    retainedOverAllowance: 0,
    missingCrop: 0,
    missingServiceFamily: 0,
    missingNailLength: 0,
    unbookableFamily: 0,
  },
  bookableFamilies: ['nail_art'],
  photos: [{
    id: 'photo-1',
    publicId: 'portfolio/photo-1',
    imageUrl: 'https://example.test/photo.jpg',
    width: 800,
    height: 1000,
    ownerVisible: true,
    discoverIncluded: true,
    serviceFamily: 'nail_art',
    nailLength: 'short',
    altText: 'Cherry ombré manicure',
    crop: null,
    eligibility: null,
  }],
};

describe('PortfolioModal destructive confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response(JSON.stringify(portfolioPayload), { status: 200 }));
    });
  });

  it('does not delete on invocation or cancel and executes the existing delete exactly once on confirm', async () => {
    const user = userEvent.setup();
    render(<PortfolioModal onClose={vi.fn()} />);

    const deleteButton = await screen.findByRole('button', { name: 'Delete Cherry ombré manicure' });
    await user.click(deleteButton);

    expect(screen.getByText('Delete this portfolio photo?')).toBeInTheDocument();
    expect(screen.getByText('“Cherry ombré manicure” will be permanently removed.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);

    await user.click(screen.getByTestId('confirm-dialog-cancel'));

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);

    await user.click(deleteButton);
    await user.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/portfolio/photo-1?salonSlug=salon-a',
      { method: 'DELETE' },
    );
  });
});

describe('PortfolioModal upload failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('keeps the refusal visible through the reload that follows it, until it is dismissed', async () => {
    const user = userEvent.setup();
    let listCalls = 0;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.startsWith('/api/admin/portfolio/upload') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({
          error: {
            code: 'IMAGE_STORAGE_UNAVAILABLE',
            message: 'Portfolio image storage is not configured',
          },
        }), { status: 503 }));
      }

      listCalls += 1;
      return Promise.resolve(new Response(JSON.stringify(portfolioPayload), { status: 200 }));
    });

    render(<PortfolioModal onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'Delete Cherry ombré manicure' });

    const callsBeforeUpload = listCalls;

    await user.click(screen.getByRole('checkbox', {
      name: 'I confirm I have permission to publicly display this image.',
    }));

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(
      fileInput,
      new File(['photo'], 'audit.png', { type: 'image/png' }),
    );

    const failure = await screen.findByTestId('portfolio-upload-error');

    // The library reload runs (partial uploads must appear) and the refusal
    // survives it — the defect was that load() cleared the same `error` state.
    await waitFor(() => expect(listCalls).toBeGreaterThan(callsBeforeUpload));

    expect(failure).toBeInTheDocument();
    expect(failure).toHaveTextContent('We can’t add photos right now');
    expect(failure).toHaveTextContent('Nothing was uploaded.');
    expect(failure).toHaveAttribute('role', 'alert');

    await user.click(screen.getByTestId('portfolio-upload-error-dismiss'));

    expect(screen.queryByTestId('portfolio-upload-error')).not.toBeInTheDocument();
  });
});
