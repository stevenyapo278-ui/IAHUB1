/**
 * Tracks ticket IDs recently created/updated by the current user.
 * Used to prevent SocketContext from showing duplicate toasts
 * when the originating component already shows its own success toast.
 */

const recentIds = new Set();
const TIMEOUT_MS = 5000;
let creationInProgress = false;
let creationTimeout = null;

export function markTicketUpdated(id) {
  recentIds.add(id);
  setTimeout(() => recentIds.delete(id), TIMEOUT_MS);
}

export function wasRecentlyUpdatedByMe(id) {
  return recentIds.has(id);
}

/** Call before POST /tickets — marks that current user is creating a ticket */
export function markCreationStarted() {
  creationInProgress = true;
  if (creationTimeout) clearTimeout(creationTimeout);
  creationTimeout = setTimeout(() => { creationInProgress = false; }, TIMEOUT_MS);
}

export function wasJustCreatedByMe() {
  return creationInProgress;
}
