import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import Fastify from "fastify";
import type { CatalogService } from "../src/catalog-service.js";
import { registerFoundationRoutes } from "../src/foundation-routes.js";
import { ProgrammingService } from "../src/programming.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Store } from "../src/database.js";
import { DomainError } from "../src/domain.js";
import { refreshAccount } from "../src/security.js";
import { readCatalogRequest } from "../src/catalog-request.js";
import { account, profile } from "./helpers.js";

function fixture(t: { after: (fn: () => void) => void }) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = account(store),
    profileId = profile(store, owner);
  const incoming = Object.assign(new EventEmitter(), { aborted: false });
  const outgoing = Object.assign(new EventEmitter(), { destroyed: false });
  return {
    store,
    owner,
    profileId,
    incoming,
    outgoing,
    request: { raw: incoming } as unknown as FastifyRequest,
    reply: { raw: outgoing } as unknown as FastifyReply,
    actor: () => refreshAccount(store, owner),
  };
}

test("catalog response survives normal GET-body close and validates fresh authority before returning", async (t) => {
  const f = fixture(t);
  let validated = false;
  const result = await readCatalogRequest(
    f.store,
    f.request,
    f.reply,
    f.actor,
    f.profileId,
    async (signal) => {
      f.incoming.emit("close");
      await Promise.resolve();
      assert.equal(signal.aborted, false);
      f.store.db
        .prepare("UPDATE accounts SET username='Renamed' WHERE id=?")
        .run(f.owner.id);
      return { items: ["page"] };
    },
    (value, current) => {
      assert.equal(current.username, "Renamed");
      assert.deepEqual(value.items, ["page"]);
      validated = true;
    },
  );
  assert.ok(validated);
  assert.deepEqual(result.items, ["page"]);
  assert.equal(f.incoming.listenerCount("aborted"), 0);
  assert.equal(f.outgoing.listenerCount("close"), 0);
});

test("disconnected catalog response cancels pending work and removes socket listeners", async (t) => {
  const f = fixture(t);
  const pending = readCatalogRequest(
    f.store,
    f.request,
    f.reply,
    f.actor,
    f.profileId,
    (signal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        });
      }),
    () => assert.fail("Disconnected work must not publish"),
  );
  f.outgoing.emit("close");
  await assert.rejects(pending, /cancelled/);
  assert.equal(f.incoming.listenerCount("aborted"), 0);
  assert.equal(f.outgoing.listenerCount("close"), 0);
});

test("profile removal while a catalog read waits cannot publish a completed private page", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    readCatalogRequest(
      f.store,
      f.request,
      f.reply,
      f.actor,
      f.profileId,
      async () => {
        await Promise.resolve();
        f.store.db
          .prepare("UPDATE profiles SET owner_account_id=NULL WHERE id=?")
          .run(f.profileId);
        return { items: ["private"] };
      },
      () => assert.fail("Revoked profile must not reach publication"),
    ),
    (error: unknown) =>
      error instanceof DomainError && error.statusCode === 404,
  );
});

test("catalog publication rejects an obsolete result after request authority is refreshed", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    readCatalogRequest(
      f.store,
      f.request,
      f.reply,
      f.actor,
      f.profileId,
      async () => ({ items: ["obsolete"] }),
      () => {
        throw new DomainError(503, "Library changed; retry");
      },
    ),
    (error: unknown) =>
      error instanceof DomainError && error.statusCode === 503,
  );
  assert.equal(f.outgoing.listenerCount("close"), 0);
});

test("production library route defaults omitted limits to a bounded reader page", async (t) => {
  const f = fixture(t),
    app = Fastify();
  const received: { offset: number; limit: number }[] = [];
  let validations = 0;
  const reader: Pick<
    CatalogService,
    | "libraryPage"
    | "optionsPage"
    | "selectionPage"
    | "treePage"
    | "assertCurrent"
  > = {
    libraryPage: async (_account, _profile, input) => {
      received.push({ offset: input.offset, limit: input.limit });
      return {
        revision: 0,
        sources: [],
        shows: [],
        movies: [],
        folders: [],
        movieCollections: [],
        savedCollections: [],
        pagination: { offset: input.offset, limit: input.limit, total: 42 },
      };
    },
    selectionPage: async () => {
      throw new Error("Unexpected selection call");
    },
    treePage: async () => {
      throw new Error("Unexpected tree call");
    },
    optionsPage: async () => {
      throw new Error("Unexpected options call");
    },
    assertCurrent: () => {
      validations++;
    },
  };
  registerFoundationRoutes(
    app,
    f.store,
    f.actor,
    new ProgrammingService(f.store),
    7,
    reader,
  );
  try {
    const first = await app.inject({
      url: `/api/profiles/${f.profileId}/library`,
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().pagination.limit, 24);
    const next = await app.inject({
      url: `/api/profiles/${f.profileId}/library?offset=24`,
    });
    assert.equal(next.statusCode, 200);
    assert.deepEqual(received, [
      { offset: 0, limit: 24 },
      { offset: 24, limit: 24 },
    ]);
    assert.equal(validations, 2);
  } finally {
    await app.close();
  }
});
