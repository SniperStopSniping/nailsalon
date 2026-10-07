/* eslint-disable style/max-statements-per-line */
export async function mockApi(page: import('@playwright/test').Page, freeSolo: boolean, authDelayMs = 0, salonSlug = 'isla') {
  const control = { failSave: false, patches: [] as unknown[] };
  let bio: string | null = null;
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3140') {
      await route.abort(); return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue(); return;
    }
    if (url.pathname === '/api/admin/auth/me') {
      if (authDelayMs) {
        await new Promise(resolve => setTimeout(resolve, authDelayMs));
      }
      await route.fulfill({ json: { user: { id: 'owner', salons: [{ slug: salonSlug, freeSoloEnabled: freeSolo }] } } }); return;
    }
    if (url.pathname === '/api/admin/booking-page') {
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        control.patches.push(body);
        if (control.failSave) {
          await route.fulfill({ status: 503, json: { error: 'Unavailable' } }); return;
        }
        if (body.content?.bio !== undefined) {
          bio = body.content.bio;
        }
      }
      const side = { layout: 'quick_book', serviceMenuLayout: 'visual_grid', stylePack: 'default', tokenOverrides: null, sectionOrder: [], sectionVariants: {}, hiddenSections: [], businessMode: 'solo', startMode: 'services_first', quickBookProfile: { showBio: false, showBookingPolicy: false, showCancellationPolicy: false, showEmail: false, showHours: false, showInstagram: false, showLocation: false, showPhone: false, showReviews: false, showTechName: false, showTechPhoto: false } };
      await route.fulfill({ json: { config: { version: 1, draft: side, live: side, draftPresetBase: { presetId: 'quick_book', recipeVersion: 1 }, livePresetBase: { presetId: 'quick_book', recipeVersion: 1 } }, content: { version: 1, draft: { heroImageUrl: null, specialtyLine: null, bio, locationDisplayMode: 'full_address' }, live: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' } }, salon: { publicationStatus: 'published' } } }); return;
    }
    if (url.pathname === '/api/admin/salon/settings') {
      await route.fulfill({ json: { bookingExperience: { primaryColor: null, bookingMessage: 'Welcome', socialLinks: { instagram: null, facebook: null, tiktok: null }, confirmationMessage: 'Thanks', policy: { enabled: false, title: null, text: null, showOnServicePage: true, showBeforeConfirmation: true, showAfterConfirmation: true, showInConfirmationEmail: true, acknowledgment: { required: false, text: null }, version: null }, quickFacts: { appointmentOnly: { enabled: false, label: null }, depositNotice: { enabled: false, label: null }, cancellationNotice: { enabled: false, label: null } } }, bookingConfig: {} } }); return;
    }
    if (url.pathname === '/api/admin/settings/modules') {
      await route.fulfill({ json: { data: { modules: {}, entitledModules: {}, moduleReasons: {} } } }); return;
    }
    if (url.pathname === '/api/admin/settings/visibility') {
      await route.fulfill({ json: { data: { visibility: { staff: {} } } } }); return;
    }
    if (url.pathname === '/api/admin/settings/booking-flow') {
      await route.fulfill({ json: { data: { bookingFlowCustomizationEnabled: true, bookingFlow: ['service', 'time', 'confirm'] } } }); return;
    }
    if (url.pathname === '/api/admin/profile') {
      await route.fulfill({ json: { user: {} } }); return;
    }
    if (url.pathname.startsWith('/api/admin/owner-assistant')) {
      await route.fulfill({ status: 404, json: {} }); return;
    }
    await route.fulfill({ json: {} });
  });
  return control;
}
