import type { FastifyReply, FastifyRequest } from "fastify";
import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { requireProfile } from "./security.js";

/** Cancel only disconnected responses, not the normal end of a GET request body. */
export async function readCatalogRequest<T>(
  store: Store,
  request: FastifyRequest,
  reply: FastifyReply,
  actor: (request: FastifyRequest) => Account,
  profileId: string,
  read: (signal: AbortSignal) => Promise<T>,
  validate: (result: T, account: Account) => void,
): Promise<T> {
  const abort = new AbortController();
  const disconnect = () => abort.abort();
  request.raw.once("aborted", disconnect);
  reply.raw.once("close", disconnect);
  if (request.raw.aborted || reply.raw.destroyed) abort.abort();
  try {
    requireProfile(store, actor(request), profileId);
    const result = await read(abort.signal);
    const current = actor(request);
    requireProfile(store, current, profileId);
    validate(result, current);
    return result;
  } finally {
    request.raw.removeListener("aborted", disconnect);
    reply.raw.removeListener("close", disconnect);
  }
}
