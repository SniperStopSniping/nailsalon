export { default } from '../../(unauth)/book/page';
// AG-w2-public-quick-book-03: the salon's own name/description/OpenGraph in
// place of the inherited generic `Luster` title. This entry route redirects
// into the first booking step, but link unfurlers and crawlers read the
// metadata of the URL the owner actually shares, which is this one.
export { generatePublicSalonMetadata as generateMetadata } from '@/libs/publicSalonMetadata.server';
