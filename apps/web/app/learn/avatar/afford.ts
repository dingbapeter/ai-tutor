/**
 * Whether to fetch a tutor's 3D character at all.
 *
 * A character is a few megabytes. On a phone whose owner has asked the
 * browser to save data, or on a connection the browser itself rates as
 * 2G, that download costs the family real money and would not finish
 * before the lesson is half over. Those learners keep the drawn face,
 * which is already on the page and just as alive. Where the browser says
 * nothing about the connection (Safari, Firefox), the character is
 * fetched: the drawn face shows until it arrives.
 */
export interface ConnectionHint {
  saveData?: boolean;
  effectiveType?: string;
}

export function canAfford3d(connection: ConnectionHint | null | undefined): boolean {
  if (!connection) return true;
  if (connection.saveData === true) return false;
  return connection.effectiveType !== "slow-2g" && connection.effectiveType !== "2g";
}
