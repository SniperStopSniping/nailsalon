import 'server-only';

import sharp from 'sharp';

// Keep the maintainer's GHSA-f88m-g3jw-g9cj and GHSA-wq5f-xc86-pv6w
// safeguards before reading untrusted metadata, including on patched builds.
// Browser MIME labels do not constrain native decoders.
// These formats are outside our JPEG/PNG/WebP upload contract.
sharp.block({
  operation: ['VipsForeignLoadNsgif', 'VipsForeignLoadTiff', 'VipsForeignLoadVips', 'VipsForeignLoadSvg'],
});

export default sharp;
