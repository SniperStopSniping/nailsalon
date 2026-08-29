export type ServiceMenuProductionMapping = {
  futureOwnerServiceOperation: string;
  labServiceId: string;
  mappingKind: 'exact_template' | 'closest_template' | 'production_gap';
  productionCanonicalId: string;
};

const TEMPLATE_OPERATION = 'Resolve the owner service by templateKey; add missing templates through POST /api/salon/services/from-templates, or PATCH the tenant-scoped owner service isActive state.';

export const SERVICE_MENU_PRODUCTION_MAPPINGS = [
  ['svc-manicure-russian', 'russian_manicure_no_colour', 'closest_template'],
  ['svc-manicure-gel', 'gel_manicure', 'exact_template'],
  ['svc-manicure-classic', 'classic_manicure', 'exact_template'],
  ['svc-builder-overlay', 'builder_gel_overlay', 'exact_template'],
  ['svc-builder-gel-colour', 'biab_gel_colour', 'exact_template'],
  ['svc-builder-refill', 'builder_gel_refill', 'exact_template'],
  ['svc-builder-full-set', 'hard_gel_extensions', 'closest_template'],
  ['svc-gelx-full-set', 'gel_x_extensions', 'exact_template'],
  ['svc-gelx-refill', 'gel_x_fill', 'exact_template'],
  ['svc-gelx-removal', 'gel_x_removal', 'closest_template'],
  ['svc-pedicure-classic', 'classic_pedicure', 'exact_template'],
  ['svc-pedicure-gel', 'gel_pedicure', 'exact_template'],
  ['svc-pedicure-spa', 'spa_pedicure', 'exact_template'],
  ['svc-art-tier-one', 'simple_nail_art', 'closest_template'],
  ['svc-art-tier-two', 'detailed_nail_art', 'closest_template'],
  ['svc-art-tier-three', 'full_nail_art_set', 'closest_template'],
  ['svc-art-tier-four', 'hand_painted_art', 'closest_template'],
  ['svc-combo-gel', 'gel_mani_gel_pedi_combo', 'exact_template'],
  ['svc-combo-biab', 'biab_gel_pedi_combo', 'closest_template'],
  ['svc-addon-french', 'french_tips', 'exact_template'],
  ['svc-addon-chrome', 'chrome', 'exact_template'],
  ['svc-addon-simple-art', 'simple_nail_art', 'exact_template'],
  ['svc-addon-detailed-art', 'detailed_nail_art', 'exact_template'],
  ['svc-addon-consultation', 'owner_authored_service', 'production_gap'],
].map(([labServiceId, productionCanonicalId, mappingKind]) => ({
  futureOwnerServiceOperation: mappingKind === 'production_gap'
    ? 'No matching Library template exists. Require an explicit authenticated owner-service create operation; do not silently invent a template key.'
    : TEMPLATE_OPERATION,
  labServiceId,
  mappingKind,
  productionCanonicalId,
})) as readonly ServiceMenuProductionMapping[];

export const ADD_ON_PRODUCTION_MAPPINGS = [
  ['addon-french', 'french_tips', 'exact_template'],
  ['addon-chrome', 'chrome', 'exact_template'],
  ['addon-simple-art', 'simple_nail_art', 'exact_template'],
  ['addon-detailed-art', 'detailed_nail_art', 'exact_template'],
].map(([labServiceId, productionCanonicalId, mappingKind]) => ({
  futureOwnerServiceOperation: TEMPLATE_OPERATION,
  labServiceId,
  mappingKind,
  productionCanonicalId,
})) as readonly ServiceMenuProductionMapping[];
