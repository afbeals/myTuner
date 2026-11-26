import type { Account } from "./domain.js";
import type { browseLibraryPage } from "./library-page.js";
import type { browseMediaPage, programmingOptions } from "./library.js";

export type LibraryPageInput = Parameters<typeof browseLibraryPage>[3];
export type MediaPageInput = Parameters<typeof browseMediaPage>[3];
export type CatalogOptionsInput = Parameters<typeof programmingOptions>[3];
export interface CatalogOperations {
  library: {
    input: LibraryPageInput;
    result: ReturnType<typeof browseLibraryPage>;
  };
  media: {
    input: MediaPageInput;
    result: ReturnType<typeof browseMediaPage>;
  };
  options: {
    input: CatalogOptionsInput;
    result: ReturnType<typeof programmingOptions>;
  };
}
export type CatalogOperation = keyof CatalogOperations;
export interface CatalogWork {
  id: number;
  epoch: string;
  generation: number;
  revision: number;
  operation: CatalogOperation;
  account: Account;
  profileId: string;
  input: LibraryPageInput | MediaPageInput | CatalogOptionsInput;
  cancellation: SharedArrayBuffer;
}
export type CatalogWorkerMessage =
  { type: "run"; work: CatalogWork } | { type: "stop" };
export type CatalogWorkerReply =
  | { type: "ready" }
  | {
      type: "result";
      id: number;
      epoch: string;
      generation: number;
      revision: number;
      result?: CatalogOperations[CatalogOperation]["result"];
      error?: { statusCode: number; message: string };
    };
export const catalogPageByteLimit = 8 * 1024 * 1024;
