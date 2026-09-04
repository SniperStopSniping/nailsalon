import { formatCustomDesignUploadSummary } from './upload-summary';

describe('Custom Design upload summaries', () => {
  it('explains partial and complete capacity rejection', () => {
    expect(formatCustomDesignUploadSummary(1, [
      { code: 'too_many_images' },
      { code: 'too_many_images' },
    ])).toBe(
      'This section can contain up to 10 images. 1 image was added and 2 were skipped because the section is full.',
    );
    expect(formatCustomDesignUploadSummary(0, [
      { code: 'too_many_images' },
      { code: 'too_many_images' },
      { code: 'too_many_images' },
    ])).toBe(
      'This section can contain up to 10 images. No images were added and 3 were skipped because the section is full.',
    );
  });

  it('keeps mixed capacity and processing counts truthful', () => {
    expect(formatCustomDesignUploadSummary(1, [
      { code: 'unsupported_type' },
      { code: 'too_many_images' },
    ])).toBe(
      'This section can contain up to 10 images. 1 image was added, 1 image was skipped because the section is full, and 1 file could not be processed.',
    );
  });

  it('retains the ordinary success and processing-failure wording', () => {
    expect(formatCustomDesignUploadSummary(3, [])).toBe('3 images were added.');
    expect(formatCustomDesignUploadSummary(0, [
      { code: 'corrupt_image' },
    ])).toBe('No images were added. 1 file could not be processed.');
  });
});
