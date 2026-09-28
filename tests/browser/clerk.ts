/**
 * Browser-component harness Clerk double.
 *
 * These Vite fixtures test UI against mocked HTTP only. Aliasing Clerk here
 * prevents its Next App Router runtime from entering the browser bundle and
 * guarantees that no identity-provider call can be made by a fixture.
 */
export function useClerk() {
  return {
    openUserProfile() {},
  };
}
