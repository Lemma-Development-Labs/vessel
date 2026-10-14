/**
 * Fixture data is opt-in. The app serves mock balances only when
 * NEXT_PUBLIC_USE_MOCK is exactly "1"; unset, empty or anything else means
 * live chain reads. The previous default (mock unless "0") meant a deploy that
 * forgot the variable silently showed fixture balances as if they were real.
 */
export function mockEnabled(flag: string | undefined): boolean {
  return flag === "1";
}
