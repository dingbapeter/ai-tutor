/**
 * The outbox: a message a child sends is never quietly lost.
 *
 * The app already tells them, in the banner at the top, that their messages
 * "will send when the connection returns". Until now that was not true: a
 * send tried twice, a second apart, and then threw the question away. On a
 * bus, in a power cut, on a village signal, that is exactly when a child is
 * most likely to be typing.
 *
 * So a question that fails for network reasons waits here instead, in the
 * browser's own storage, and goes out in order when the connection comes
 * back. The rules are pure so they can be tested without a browser, and
 * deliberately conservative:
 *
 *   - Only NETWORK failures wait. A refusal the server actually made (out of
 *     messages today, session ended, not signed in) is a real answer, and
 *     retrying it would be dishonest and would spend the family's allowance.
 *   - Order is kept. A child's second thought makes no sense before the first.
 *   - Nothing waits forever. A question answered a day later is a confusing
 *     interruption, not a lesson, so a stale one is dropped and said so.
 *   - The queue is capped, because a browser store is not infinite and a
 *     phone offline for an hour should not fill it.
 */

export interface Outgoing {
  /** Made when the message is queued, so a resend can never double-post. */
  id: string;
  sessionId: string;
  text: string;
  /** "plain" | "story" | "comic" | "song", as the learner chose. */
  format: string;
  /** When the learner pressed send, in milliseconds. */
  queuedAt: number;
}

/** Anything older than this is stale: answering it later confuses more than it helps. */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** A phone can be offline a long time; the store cannot hold everything. */
export const MAX_WAITING = 20;

/**
 * Should this failure wait for a better connection?
 *
 * A thrown fetch (no network, DNS gone, connection cut) waits. Anything the
 * server answered, including its refusals, does not: the server spoke, and
 * its answer is the truth of the matter.
 */
export function shouldWait(outcome: { threw: boolean; status?: number }): boolean {
  if (!outcome.threw) return false;
  return outcome.status === undefined;
}

/** Add to the back of the queue. Returns the new queue, and what happened. */
export function enqueue(
  queue: Outgoing[],
  item: Outgoing,
  max: number = MAX_WAITING,
): { queue: Outgoing[]; accepted: boolean } {
  if (queue.some((q) => q.id === item.id)) return { queue, accepted: false };
  if (queue.length >= max) return { queue, accepted: false };
  return { queue: [...queue, item], accepted: true };
}

/** Drop one, by id, once it has genuinely been sent or genuinely refused. */
export function remove(queue: Outgoing[], id: string): Outgoing[] {
  return queue.filter((q) => q.id !== id);
}

/**
 * Split the queue into what is still worth sending and what has gone stale.
 * Both halves matter: the learner is told about the stale ones rather than
 * left to wonder where their question went.
 */
export function partitionStale(
  queue: Outgoing[],
  now: number,
  staleAfter: number = STALE_AFTER_MS,
): { fresh: Outgoing[]; stale: Outgoing[] } {
  const fresh: Outgoing[] = [];
  const stale: Outgoing[] = [];
  for (const item of queue) {
    (now - item.queuedAt >= staleAfter ? stale : fresh).push(item);
  }
  return { fresh, stale };
}

/** What still belongs to the session on screen, oldest first. */
export function readyFor(queue: Outgoing[], sessionId: string): Outgoing[] {
  return queue.filter((q) => q.sessionId === sessionId).sort((a, b) => a.queuedAt - b.queuedAt);
}

/** One line for the learner: plain, honest, never alarming. */
type Translate = (key: string, params?: Record<string, string | number>) => string;
const english: Translate = (key, params) => key.replace("{n}", String(params?.n ?? ""));

export function waitingLine(count: number, t: Translate = english): string {
  if (count <= 0) return "";
  return count === 1
    ? t("1 message is waiting for the connection. It sends itself when you are back online.")
    : t("{n} messages are waiting for the connection. They send themselves when you are back online.", { n: count });
}

const KEY = "dingba_outbox";

/** Read the queue. A browser with no storage simply has no queue. */
export function loadQueue(storage: Pick<Storage, "getItem" | "setItem"> | undefined): Outgoing[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Outgoing =>
        !!p && typeof p === "object" &&
        typeof (p as Outgoing).id === "string" &&
        typeof (p as Outgoing).sessionId === "string" &&
        typeof (p as Outgoing).text === "string" &&
        typeof (p as Outgoing).queuedAt === "number",
    );
  } catch {
    return [];
  }
}

/** Write the queue. Storage that refuses (private mode, full) loses nothing else. */
export function saveQueue(storage: Pick<Storage, "getItem" | "setItem"> | undefined, queue: Outgoing[]): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(queue));
  } catch {
    /* A browser that will not remember is still a browser that works. */
  }
}

/** An id that does not need crypto.randomUUID, which older Safari lacks. */
export function newId(now: number, rand: number = Math.random()): string {
  return `${now.toString(36)}-${Math.floor(rand * 1e9).toString(36)}`;
}
