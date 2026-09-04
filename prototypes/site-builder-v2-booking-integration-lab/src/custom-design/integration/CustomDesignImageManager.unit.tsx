import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import type { CustomDesignImageItem } from '../model/types';
import { CustomDesignImageManager } from './CustomDesignImageManager';

const image = (id: string): CustomDesignImageItem => ({
  altText: '',
  aspectRatio: 0.75,
  assetId: `asset-${id}`,
  decorative: false,
  fileName: `${id}.png`,
  fileSize: 100,
  height: 1_600,
  id,
  interactiveAreas: [],
  mimeType: 'image/png',
  width: 1_200,
});

describe('CustomDesignImageManager', () => {
  it('exposes missing pages, shared thumbnails, reorder, Replace, Remove, and one add action', async () => {
    const user = userEvent.setup();
    const onCommitImageOrder = vi.fn();
    const onRemoveImage = vi.fn();
    const onReplaceImage = vi.fn();
    render(
      <CustomDesignImageManager
        assets={{
          'asset-first': { status: 'ready', thumbnailUrl: 'blob:first-thumb', url: 'blob:first' },
          'asset-missing': { reason: 'This saved page is missing.', status: 'missing' },
        }}
        images={[image('first'), image('missing')]}
        onAddImages={vi.fn()}
        onCommitImageOrder={onCommitImageOrder}
        onRemoveImage={onRemoveImage}
        onReplaceImage={onReplaceImage}
      />,
    );

    expect(screen.getByText('This saved page is missing.')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Thumbnail unavailable' })).toBeVisible();
    expect(screen.getByText('missing.png')).toBeVisible();
    expect(screen.getByLabelText('Choose more images')).toHaveClass('visually-hidden');
    expect(screen.getAllByLabelText(/Choose more images/u)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Move page 1 down' }));
    await user.click(screen.getByRole('button', { name: 'Save order' }));

    expect(onCommitImageOrder).toHaveBeenCalledWith(['missing', 'first']);

    const missingRow = screen.getByText('missing.png').closest('li')!;
    await user.click(within(missingRow).getByRole('button', { name: 'Remove' }));

    expect(onRemoveImage).toHaveBeenCalledWith('missing');

    const replacement = new File(['replacement'], 'replacement.webp', { type: 'image/webp' });
    await user.upload(within(missingRow).getByLabelText('Replace'), replacement);

    expect(onReplaceImage).toHaveBeenCalledWith('missing', replacement);
  });
});
