import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChangeSalonSlugModal } from './ChangeSalonSlugModal';

const fetchMock = vi.fn();

function slugResult(slug: string, publicUrl: string) {
  return {
    salon: {
      id: 'salon_1',
      name: 'Isla Nail Studio',
      slug,
      customDomain: null,
      slugLockedAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-21T12:00:00.000Z',
    },
    canonicalUrls: {
      publicUrl,
      bookingUrl: `${publicUrl}/book`,
      findBookingUrl: `${publicUrl}/find-booking`,
    },
  };
}

const defaultProps = {
  isOpen: true,
  salonId: 'salon_1',
  salonName: 'Isla Nail Studio',
  currentSlug: 'isla-nail-studio1',
  canonicalPublicUrl: 'https://islanailsalon.com/en/isla-nail-studio1',
  hasCustomDomain: false,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
  onConflict: vi.fn(),
};

function renderModal(overrides: Partial<typeof defaultProps> = {}) {
  const props = {
    ...defaultProps,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
    onConflict: vi.fn(),
    ...overrides,
  };

  render(<ChangeSalonSlugModal {...props} />);
  return props;
}

describe('ChangeSalonSlugModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes the slug, previews the new path URL, and requires acknowledgment', async () => {
    const result = slugResult('renamed-salon', 'https://islanailsalon.com/en/renamed-salon');
    fetchMock.mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));
    const props = renderModal();

    const input = screen.getByLabelText('Website address');
    fireEvent.change(input, { target: { value: '  RENAMED-SALON  ' } });

    expect(input).toHaveValue('  renamed-salon  ');
    expect(screen.getByText('https://islanailsalon.com/en/renamed-salon')).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'Change address' });

    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', {
      name: /I understand that links using the old address will stop working/i,
    }));

    expect(submit).toBeEnabled();

    fireEvent.click(submit);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/super-admin/organizations/salon_1/slug',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: 'renamed-salon',
            expectedCurrentSlug: 'isla-nail-studio1',
          }),
        },
      );
    });

    expect(props.onSuccess).toHaveBeenCalledWith(result);
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('rejects reserved addresses before a request can be sent', () => {
    renderModal();

    fireEvent.change(screen.getByLabelText('Website address'), {
      target: { value: 'SUPER-ADMIN' },
    });

    expect(screen.getByText(/cannot begin or end with a hyphen or use a reserved Luster name/i))
      .toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Change address' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a custom domain unchanged while updating the internal slug', () => {
    renderModal({
      canonicalPublicUrl: 'https://isla-nail-studio1.example/',
      hasCustomDomain: true,
    });

    fireEvent.change(screen.getByLabelText('Website address'), {
      target: { value: 'new-isla-name' },
    });

    expect(screen.getByText('Public domain stays the same')).toBeInTheDocument();
    expect(screen.getByText('https://isla-nail-studio1.example/')).toBeInTheDocument();
    expect(screen.getByText(/only its internal salon slug will be updated/i)).toBeInTheDocument();
  });

  it('previews a changed tenant subdomain without changing the root host', () => {
    renderModal({
      currentSlug: 'old-salon',
      canonicalPublicUrl: 'https://old-salon.staging.luster.example/',
    });

    fireEvent.change(screen.getByLabelText('Website address'), {
      target: { value: 'new-salon' },
    });

    expect(screen.getByText('https://new-salon.staging.luster.example/')).toBeInTheDocument();
  });

  it('shows a server conflict and leaves the dialog open', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: 'A salon with this slug already exists',
    }), { status: 409 }));
    const props = renderModal();

    fireEvent.change(screen.getByLabelText('Website address'), {
      target: { value: 'already-taken' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Change address' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A salon with this slug already exists');
    expect(props.onSuccess).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('adopts the latest server slug after a stale edit so the operator can retry', async () => {
    const staleResult = slugResult('newer-current-slug', 'https://islanailsalon.com/en/newer-current-slug');
    const successResult = slugResult('my-target-slug', 'https://islanailsalon.com/en/my-target-slug');
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...staleResult,
        error: 'The salon slug changed since this page was loaded',
        currentSlug: 'newer-current-slug',
      }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(successResult), { status: 200 }));
    const props = renderModal();

    fireEvent.change(screen.getByLabelText('Website address'), {
      target: { value: 'my-target-slug' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Change address' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('newer-current-slug');
    expect(props.onConflict).toHaveBeenCalledWith(expect.objectContaining(staleResult));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('https://islanailsalon.com/en/my-target-slug')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Change address' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/super-admin/organizations/salon_1/slug',
        expect.objectContaining({
          body: JSON.stringify({
            slug: 'my-target-slug',
            expectedCurrentSlug: 'newer-current-slug',
          }),
        }),
      );
    });

    expect(props.onSuccess).toHaveBeenCalledWith(successResult);
  });
});
