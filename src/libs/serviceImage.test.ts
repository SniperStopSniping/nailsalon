import { describe, expect, it } from 'vitest';

import { resolveServiceCardImage, SERVICE_IMAGE } from '@/libs/serviceImage';
import { SERVICE_TEMPLATES } from '@/libs/serviceTemplateCatalog';

const COMBO_IMAGES = new Set<string>([
  SERVICE_IMAGE.comboNude,
  SERVICE_IMAGE.comboFrench,
  SERVICE_IMAGE.comboChampagne,
  SERVICE_IMAGE.comboBuilder,
]);

const PEDICURE_IMAGES = new Set<string>([
  SERVICE_IMAGE.pedicureGel,
  SERVICE_IMAGE.pedicureClassic,
  SERVICE_IMAGE.pedicureFrench,
  SERVICE_IMAGE.pedicureToes,
  SERVICE_IMAGE.pedicureBare,
]);

const HANDS_IMAGES = new Set<string>([
  SERVICE_IMAGE.manicureGel,
  SERVICE_IMAGE.manicureRussian,
  SERVICE_IMAGE.manicureBare,
  SERVICE_IMAGE.manicureBuilder,
  SERVICE_IMAGE.manicureLuster,
  SERVICE_IMAGE.manicureFrench,
  SERVICE_IMAGE.manicureCatEye,
  SERVICE_IMAGE.manicurePearl,
  SERVICE_IMAGE.extensionsGelX,
  SERVICE_IMAGE.extensionsHardGel,
]);

const bookableTemplates = SERVICE_TEMPLATES.filter(template => template.serviceType !== 'addon');

describe('resolveServiceCardImage', () => {
  it('keeps a salon-uploaded Cloudinary image', () => {
    const uploaded = 'https://res.cloudinary.com/demo/image/upload/mani.jpg';

    expect(resolveServiceCardImage({ imageUrl: uploaded, templateKey: 'gel_manicure' })).toBe(uploaded);
  });

  it('ignores unusable stored urls and falls back to the mapping', () => {
    expect(resolveServiceCardImage({ imageUrl: '/uploads/old.png', templateKey: 'gel_manicure' })).toBe(
      SERVICE_IMAGE.manicureGel,
    );
  });

  it.each(bookableTemplates.map(t => [t.systemKey, t.bookingCategory, t.name] as const))(
    'assigns %s an image inside its own family',
    (systemKey, bookingCategory, name) => {
      const image = resolveServiceCardImage({ templateKey: systemKey, bookingCategory, name });

      if (bookingCategory === 'combo') {
        expect(COMBO_IMAGES, `${systemKey} must show hands and feet`).toContain(image);

        return;
      }

      if (bookingCategory === 'pedicure') {
        expect(PEDICURE_IMAGES, `${systemKey} must show feet`).toContain(image);

        return;
      }

      expect(HANDS_IMAGES, `${systemKey} must show hands`).toContain(image);
    },
  );

  it('never gives a manicure a pedicure image, or vice versa', () => {
    for (const template of bookableTemplates) {
      const image = resolveServiceCardImage({
        templateKey: template.systemKey,
        bookingCategory: template.bookingCategory,
        name: template.name,
      });

      if (template.bookingCategory === 'manicure') {
        expect(PEDICURE_IMAGES.has(image), template.systemKey).toBe(false);
        expect(COMBO_IMAGES.has(image), template.systemKey).toBe(false);
      }

      if (template.bookingCategory === 'pedicure') {
        expect(HANDS_IMAGES.has(image), template.systemKey).toBe(false);
      }
    }
  });

  it('falls back within the family for unknown template keys', () => {
    expect(resolveServiceCardImage({ templateKey: 'builder_gel_something_new' })).toBe(SERVICE_IMAGE.manicureBuilder);
    expect(resolveServiceCardImage({ templateKey: 'gel_x_something_new' })).toBe(SERVICE_IMAGE.extensionsGelX);
    expect(resolveServiceCardImage({ templateKey: 'mystery_pedicure_deluxe' })).toBe(SERVICE_IMAGE.pedicureGel);
    expect(resolveServiceCardImage({ templateKey: 'mystery_manicure_deluxe' })).toBe(SERVICE_IMAGE.manicureGel);
    expect(resolveServiceCardImage({ templateKey: 'mystery_key', bookingCategory: 'combo' })).toBe(
      SERVICE_IMAGE.comboNude,
    );
  });

  it('picks a specific image from the name when a service has no template key', () => {
    expect(resolveServiceCardImage({ name: 'Gel Manicure + Gel Pedicure' })).toBe(SERVICE_IMAGE.comboNude);
    expect(resolveServiceCardImage({ name: 'BIAB (Builder Gel on Natural Nails)' })).toBe(SERVICE_IMAGE.manicureBuilder);
    expect(resolveServiceCardImage({ name: 'Gel-X Full Set' })).toBe(SERVICE_IMAGE.extensionsGelX);
    expect(resolveServiceCardImage({ name: 'Shellac Toes' })).toBe(SERVICE_IMAGE.pedicureToes);
    expect(resolveServiceCardImage({ name: 'Deluxe Manicure' })).toBe(SERVICE_IMAGE.manicureGel);
    expect(resolveServiceCardImage({ name: 'Cat Eye Manicure' })).toBe(SERVICE_IMAGE.manicureCatEye);
    expect(resolveServiceCardImage({ name: 'French Pedicure' })).toBe(SERVICE_IMAGE.pedicureFrench);
    expect(resolveServiceCardImage({ name: 'Russian Manicure (No Color)' })).toBe(SERVICE_IMAGE.manicureBare);
    expect(resolveServiceCardImage({ name: 'Chrome Manicure' })).toBe(SERVICE_IMAGE.manicurePearl);
  });

  it('shows bare nails for no-colour and removal services', () => {
    expect(resolveServiceCardImage({ templateKey: 'classic_manicure_no_polish' })).toBe(SERVICE_IMAGE.manicureBare);
    expect(resolveServiceCardImage({ templateKey: 'classic_pedicure_no_polish' })).toBe(SERVICE_IMAGE.pedicureBare);
    expect(resolveServiceCardImage({ name: 'Classic Manicure \u2014 No Polish' })).toBe(SERVICE_IMAGE.manicureBare);
    expect(resolveServiceCardImage({ name: 'Classic Pedicure \u2014 No Polish' })).toBe(SERVICE_IMAGE.pedicureBare);
    expect(resolveServiceCardImage({ name: 'Russian Manicure (No Color)' })).toBe(SERVICE_IMAGE.manicureBare);
    expect(resolveServiceCardImage({ name: 'Gel Removal \u2014 Toes' })).toBe(SERVICE_IMAGE.pedicureBare);
    expect(resolveServiceCardImage({ name: 'Toenail Trim and Shape' })).toBe(SERVICE_IMAGE.pedicureBare);

    // A Russian manicure that does get colour keeps the polished look.
    expect(resolveServiceCardImage({ name: 'Russian Manicure' })).toBe(SERVICE_IMAGE.manicureRussian);
  });

  it('keeps name-matched combos on a hands-and-feet image', () => {
    const comboNames = [
      'BIAB + Classic Pedicure',
      'BIAB + Lavender Spa Pedicure',
      'Gel X / Hard Gel Extensions + Classic Pedicure',
      'Gel X / Hard Gel Extensions + Deluxe Lavender Pedicure',
    ];

    for (const name of comboNames) {
      expect(COMBO_IMAGES, name).toContain(resolveServiceCardImage({ name, bookingCategory: 'combo' }));
    }
  });
});
