# Salon chooser visibility release

Migration `0095_salon_chooser_visibility` adds one nullable timestamp to each admin-salon membership. Existing memberships remain visible. The owner-only chooser action updates only the requesting owner's membership and can be reversed from **Removed salons**. It does not delete salon, booking, or billing records.

## Release order

1. Review the exact SQL, snapshot, journal entry, CI postimage pins, and final application SHA. Confirm the target environment's migration ledger is complete through 0094 and 0095 is absent.
2. Apply 0095 through the guarded environment-specific migration command and verify the new column and ledger entry. Production requires the verified backup and `LUSTER_PRODUCTION_CONFIRM` controls in `README.md`; it must not run from CI.
3. Only after that verification, deploy the application commit. `loadAdminWithSalons()` selects the new column on sign-in; deploying code first would break admin session loading.
4. On Preview, test one owner with two salons: remove a cancelled salon, confirm it leaves the main list, restore it, confirm another owner still sees their own list, and check a direct authorized salon link. Repeat a bounded read-only check on Production after deployment.

Do not merge or deploy the application commit if the target database has not applied 0095.
