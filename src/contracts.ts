import { z } from "zod";
export const uuid = z.string().uuid();
export const capabilitiesSchema = z
  .object({
    containers: z.array(z.string().max(40)).max(50),
    videoCodecs: z.array(z.string().max(40)).max(50),
    audioCodecs: z.array(z.string().max(40)).max(50),
  })
  .strict();
export const breakRulesSchema = z
  .object({
    between: z.boolean(),
    positions: z
      .array(
        z
          .object({
            kind: z.enum(["percent", "timestamp"]),
            value: z.number().positive(),
          })
          .strict(),
      )
      .max(100),
    random: z
      .object({
        count: z.number().int().min(0).max(100),
        minPercent: z.number().positive(),
        maxPercent: z.number().lt(100),
      })
      .strict()
      .optional(),
    maxClips: z.number().int().min(0).max(100),
    maxDurationMs: z.number().int().min(0).max(3600000),
    overflowPolicy: z.enum(["skip", "truncate"]).optional(),
    minRemainingMs: z.number().int().min(0).max(3600000).optional(),
    repeatAllowance: z.number().int().min(1).max(100),
    maxPerBreak: z.number().int().min(1).max(100),
    cooldownMs: z.number().int().min(0).max(604800000),
  })
  .strict();
export const selectionSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("media"), ids: z.array(uuid).min(1).max(5000) })
    .strict(),
  z
    .object({
      type: z.literal("folder"),
      sourceId: uuid,
      directory: z.string().default(""),
      recursive: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("show"),
      sourceId: uuid,
      key: z.string().min(1).max(500),
      season: z.number().int().nonnegative().optional(),
      includeSpecials: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      type: z.literal("movieCollection"),
      sourceId: uuid,
      key: z.string().min(1).max(500),
    })
    .strict(),
  z.object({ type: z.literal("collection"), id: uuid }).strict(),
]);
export type Selection = z.infer<typeof selectionSchema>;
export const programmingSchema = z
  .object({
    profileId: uuid,
    groups: z
      .array(
        z
          .object({
            id: z.string().min(1).max(120),
            mode: z.enum(["ordered", "shuffle", "random"]),
            episodesPerTurn: z.number().int().min(1).max(3).optional(),
            selection: selectionSchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
    checkpointActions: z
      .array(
        z.discriminatedUnion("action", [
          z
            .object({
              groupId: z.string().min(1).max(120),
              action: z.literal("restart"),
            })
            .strict(),
          z
            .object({
              groupId: z.string().min(1).max(120),
              action: z.literal("startAt"),
              mediaId: uuid,
            })
            .strict(),
        ]),
      )
      .max(100)
      .optional(),
    commercialSelection: selectionSchema.optional(),
    disabledCommercialIds: z.array(uuid).max(5000).optional(),
    expectedRevisionId: uuid.nullable().optional(),
    rules: breakRulesSchema,
    seed: z.number().int().min(0).max(0xffffffff).default(42),
  })
  .strict();
export type Programming = z.infer<typeof programmingSchema>;
export const accountResponseSchema = z.object({
  id: uuid,
  username: z.string(),
  role: z.enum(["admin", "editor", "viewer"]),
  disabled: z.boolean(),
});
export const mediaResponseSchema = z.object({
  id: uuid,
  sourceId: uuid,
  relativePath: z.string(),
  title: z.string(),
  durationMs: z.number().int().positive(),
  available: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
});
export const channelResponseSchema = z.object({
  description: z.string(),
  detailsRevision: z.number().int().nonnegative(),
  id: uuid,
  name: z.string(),
  ownerAccountId: uuid.nullable(),
  visibility: z.enum(["shared", "private"]),
});
export const profileResponseSchema = z.object({
  id: uuid,
  name: z.string(),
  kind: z.enum(["person", "room"]),
  ownerAccountId: uuid.nullable(),
  pinProtected: z.boolean(),
  locked: z.boolean(),
});
export const scheduleEntrySchema = z.object({
  id: uuid,
  channelId: uuid,
  mediaId: uuid,
  programId: uuid,
  startMs: z.number().int(),
  endMs: z.number().int(),
  offsetMs: z.number().int().nonnegative(),
  kind: z.enum(["program", "commercial"]),
});
export const playbackResponseSchema = z.object({
  id: uuid,
  profileId: uuid,
  channelId: uuid,
  revisionId: uuid,
  paused: z.boolean(),
  positionMs: z.number().int(),
  behindLiveMs: z.number().int().nonnegative(),
  available: z.boolean(),
  playback: z
    .object({
      entry: scheduleEntrySchema,
      offsetMs: z.number().int().nonnegative(),
    })
    .nullable(),
});
export function contractSchemas() {
  return Object.fromEntries(
    Object.entries({
      selection: selectionSchema,
      programming: programmingSchema,
      breakRules: breakRulesSchema,
      account: accountResponseSchema,
      media: mediaResponseSchema,
      channel: channelResponseSchema,
      profile: profileResponseSchema,
      scheduleEntry: scheduleEntrySchema,
      playback: playbackResponseSchema,
    }).map(([name, schema]) => [name, z.toJSONSchema(schema)]),
  );
}
