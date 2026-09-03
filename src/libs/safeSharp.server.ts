import 'server-only';

import sharp from 'sharp';

// Apply the maintainer's GHSA-f88m-g3jw-g9cj workaround before even reading
// untrusted metadata. Browser MIME labels do not constrain native decoders.
// These formats are outside our JPEG/PNG/WebP upload contract.
sharp.block({
  operation: ['VipsForeignLoadNsgif', 'VipsForeignLoadTiff', 'VipsForeignLoadVips'],
});

export default sharp;
