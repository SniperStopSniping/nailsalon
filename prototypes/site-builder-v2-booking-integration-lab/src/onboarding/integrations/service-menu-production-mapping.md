# Service-menu Production mapping

Lab IDs identify only the canonical UX-Lab Booking fixture. Production must
resolve the corresponding `templateKey`, then resolve the tenant-owned service
row. Adding uses the existing authenticated `POST
/api/salon/services/from-templates`; removing means updating the resolved
tenant-owned service through the existing PATCH route. It does not delete or
rewrite a Library template.

| Lab selected service ID | Production canonical service/library ID | Future owner-service operation |
| --- | --- | --- |
| `svc-manicure-russian` | `russian_manicure_no_colour` (closest) | Add/resolve by `templateKey`; owner confirms the colour difference before write. |
| `svc-manicure-gel` | `gel_manicure` | Add/resolve by `templateKey`; PATCH tenant owner-service active state for removal. |
| `svc-manicure-classic` | `classic_manicure` | Same template add/resolve and tenant-scoped PATCH seam. |
| `svc-builder-overlay` | `builder_gel_overlay` | Same template add/resolve and tenant-scoped PATCH seam. |
| `svc-builder-gel-colour` | `biab_gel_colour` | Same template add/resolve and tenant-scoped PATCH seam. |
| `svc-builder-refill` | `builder_gel_refill` | Same template add/resolve and tenant-scoped PATCH seam. |
| `svc-builder-full-set` | `hard_gel_extensions` (closest) | Require owner confirmation, then add/resolve the chosen Production template. |
| `svc-gelx-full-set` | `gel_x_extensions` | Add/resolve by `templateKey`; PATCH tenant owner-service active state for removal. |
| `svc-gelx-refill` | `gel_x_fill` | Same template add/resolve and tenant-scoped PATCH seam. |
| `svc-gelx-removal` | `gel_x_removal` (Production add-on) | Require owner confirmation because the Production record type differs. |
| `svc-pedicure-classic` | `classic_pedicure` | Add/resolve by `templateKey`; PATCH tenant owner-service active state for removal. |
| `svc-pedicure-gel` | `gel_pedicure` | Same template add/resolve and tenant-scoped PATCH seam. |
| `svc-pedicure-spa` | `spa_pedicure` | Same template add/resolve and tenant-scoped PATCH seam. |
| `svc-art-tier-one` | `simple_nail_art` (closest add-on) | Require owner confirmation, then add/resolve the chosen add-on template. |
| `svc-art-tier-two` | `detailed_nail_art` (closest add-on) | Require owner confirmation, then add/resolve the chosen add-on template. |
| `svc-art-tier-three` | `full_nail_art_set` (closest add-on) | Require owner confirmation, then add/resolve the chosen add-on template. |
| `svc-art-tier-four` | `hand_painted_art` (closest add-on) | Require owner confirmation, then add/resolve the chosen add-on template. |
| `svc-combo-gel` | `gel_mani_gel_pedi_combo` | Add/resolve by `templateKey`; PATCH tenant owner-service active state for removal. |
| `svc-combo-biab` | `biab_gel_pedi_combo` (closest) | Require owner confirmation, then add/resolve the chosen combo template. |
| `svc-addon-french` | `french_tips` | Add/resolve by `templateKey`; PATCH the tenant-owned add-on state for removal. |
| `svc-addon-chrome` | `chrome` | Same template add/resolve and tenant-scoped owner add-on seam. |
| `svc-addon-simple-art` | `simple_nail_art` | Same template add/resolve and tenant-scoped owner add-on seam. |
| `svc-addon-detailed-art` | `detailed_nail_art` | Same template add/resolve and tenant-scoped owner add-on seam. |
| `svc-addon-consultation` | No template (`owner_authored_service`) | Production gap: require an explicit authenticated owner-service create; never invent a template key. |

This table is migration metadata, not a second catalogue. Names, prices,
durations, categories, images, and compatibility remain owned by the existing
Production Library and owner-menu records.

The separate Add-ons tab derives from the canonical Booking `MOCK_ADD_ONS`
fixture and stores only these stable IDs:

| Lab selected add-on ID | Production canonical add-on/library ID | Future owner-service operation |
| --- | --- | --- |
| `addon-french` | `french_tips` | Resolve the tenant-owned add-on by template key; activate/deactivate through the existing owner-menu seam. |
| `addon-chrome` | `chrome` | Same authenticated, tenant-scoped add-on operation. |
| `addon-simple-art` | `simple_nail_art` | Same authenticated, tenant-scoped add-on operation. |
| `addon-detailed-art` | `detailed_nail_art` | Same authenticated, tenant-scoped add-on operation. |
