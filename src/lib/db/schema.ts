import { relations, sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
  real,
  unique,
} from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .default(false)
    .notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  role: text("role").default("user").notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  packingLists: many(packingList),
  packingListFavourites: many(packingListFavourite),
  entries: many(entry),
  entryVisits: many(entryVisit),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

/*
 * Application tables. Everything above is owned by better-auth and regenerated
 * by its CLI; keep app tables below that line so a regeneration is easy to diff.
 */

export const packingList = sqliteTable(
  "packing_list",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    isPublic: integer("is_public", { mode: "boolean" })
      .default(false)
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("packing_list_userId_idx").on(table.userId),
    // Serves the public listing, which always filters on `is_public` and falls
    // back to recency when two lists have the same number of favourites.
    index("packing_list_public_createdAt_idx").on(table.isPublic, table.createdAt),
  ],
);

export const packingListItem = sqliteTable(
  "packing_list_item",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => packingList.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    // Explicit ordering: SQLite gives no row-order guarantee without it.
    position: integer("position").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("packing_list_item_listId_position_idx").on(table.listId, table.position),
  ],
);

export const packingListFavourite = sqliteTable(
  "packing_list_favourite",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    listId: text("list_id")
      .notNull()
      .references(() => packingList.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    // One favourite per user per list, and the natural lookup key for
    // "which of these lists has this user favourited".
    primaryKey({
      name: "packing_list_favourite_pk",
      columns: [table.userId, table.listId],
    }),
    // Counting favourites per list is the sort key of the public listing.
    index("packing_list_favourite_listId_idx").on(table.listId),
  ],
);

export const packingListRelations = relations(packingList, ({ one, many }) => ({
  owner: one(user, {
    fields: [packingList.userId],
    references: [user.id],
  }),
  items: many(packingListItem),
  favourites: many(packingListFavourite),
}));

export const packingListItemRelations = relations(packingListItem, ({ one }) => ({
  list: one(packingList, {
    fields: [packingListItem.listId],
    references: [packingList.id],
  }),
}));

export const packingListFavouriteRelations = relations(
  packingListFavourite,
  ({ one }) => ({
    user: one(user, {
      fields: [packingListFavourite.userId],
      references: [user.id],
    }),
    list: one(packingList, {
      fields: [packingListFavourite.listId],
      references: [packingList.id],
    }),
  }),
);

/*
 * Places: locations and activities. See docs/features/places.md.
 *
 * One `entry` row per thing, with `location_detail` and `activity_detail` each
 * optional — an entry may have both, which is how a wild swimming spot is one
 * row rather than a lake and a swim that duplicate each other.
 */

export const entryType = sqliteTable(
  "entry_type",
  {
    id: text("id").primaryKey(),
    // Strictly 'location' | 'activity'. Scopes the vocabulary, and is a
    // different thing from `entry.kind`, which may also be 'both'.
    kind: text("kind").notNull(),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    // An emoji, and nullable on purpose: some types have no honest one. The UI
    // never renders it alone, so a missing icon costs nothing.
    icon: text("icon"),
    colour: text("colour"),
    position: integer("position").default(0).notNull(),
    isActive: integer("is_active", { mode: "boolean" })
      .default(true)
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    unique("entry_type_kind_slug_unq").on(table.kind, table.slug),
    index("entry_type_kind_position_idx").on(table.kind, table.position),
  ],
);

export const entry = sqliteTable(
  "entry",
  {
    id: text("id").primaryKey(),
    // Derived from which detail rows exist: 'location' | 'activity' | 'both'.
    // A cache of the detail tables, rewritten on every save so a listing can
    // filter and badge without joining both of them.
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    // Derived from the name once and then frozen: a shared link should keep
    // working after a rename.
    slug: text("slug").notNull().unique(),
    description: text("description"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    visibility: text("visibility").default("private").notNull(),
    // The representative point: the pin, and what distance is measured from.
    lat: real("lat"),
    lng: real("lng"),
    // How literally to read that point: 'point' | 'area' | 'region'.
    extent: text("extent").default("point").notNull(),
    bboxMinLat: real("bbox_min_lat"),
    bboxMinLng: real("bbox_min_lng"),
    bboxMaxLat: real("bbox_max_lat"),
    bboxMaxLng: real("bbox_max_lng"),
    // How to reach that point: "toll road", "20 min walk in", "gate is
    // usually shut, park on the verge". It sits here rather than on
    // `location_detail` because it describes the point above it, and an
    // activity has a way in as much as a place does.
    access: text("access"),
    // Bitmask: spring 1, summer 2, autumn 4, winter 8. 0 means any time, and
    // needs no special case in a filter: `seasons = 0 or seasons & ? != 0`.
    seasons: integer("seasons").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("entry_userId_idx").on(table.userId),
    // Serves the public listing, which always filters on visibility and orders
    // by recency.
    index("entry_visibility_createdAt_idx").on(table.visibility, table.createdAt),
    // Prefilters the map's bounding box.
    index("entry_lat_lng_idx").on(table.lat, table.lng),
  ],
);

export const locationDetail = sqliteTable("location_detail", {
  entryId: text("entry_id")
    .primaryKey()
    .references(() => entry.id, { onDelete: "cascade" }),
  typeId: text("type_id")
    .notNull()
    .references(() => entryType.id),
  // Free-form extras, stored as JSON text, rendered as a key/value list and
  // never queried in SQL — anything in here that wants filtering has earned a
  // column. It sits beside the type, because that is what decides which extras
  // a thing has: a hybrid's lake facts and swim facts are different sets.
  attributes: text("attributes"),
});

export const activityDetail = sqliteTable("activity_detail", {
  entryId: text("entry_id")
    .primaryKey()
    .references(() => entry.id, { onDelete: "cascade" }),
  typeId: text("type_id")
    .notNull()
    .references(() => entryType.id),
  // 'easy' | 'moderate' | 'difficult' | null for unknown.
  difficulty: text("difficulty"),
  // 'short' | 'half_day' | 'full_day' | 'multi_day' | null. Stored rather than
  // derived on read, so a filter can use an index.
  durationBucket: text("duration_bucket"),
  durationMinutes: integer("duration_minutes"),
  // Tri-state: 1 yes, 0 no, null not marked. "Unknown" and "not for small
  // children" are different answers.
  familyFriendly: integer("family_friendly", { mode: "boolean" }),
  distanceM: integer("distance_m"),
  ascentM: integer("ascent_m"),
  // See `locationDetail.attributes`.
  attributes: text("attributes"),
});

export const entryLink = sqliteTable(
  "entry_link",
  {
    id: text("id").primaryKey(),
    fromEntryId: text("from_entry_id")
      .notNull()
      .references(() => entry.id, { onDelete: "cascade" }),
    toEntryId: text("to_entry_id")
      .notNull()
      .references(() => entry.id, { onDelete: "cascade" }),
    // A fixed vocabulary, not free text: two people writing "parking" and
    // "park at" would stop the graph answering questions.
    relation: text("relation").notNull(),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    unique("entry_link_unq").on(
      table.fromEntryId,
      table.toEntryId,
      table.relation,
    ),
    index("entry_link_from_idx").on(table.fromEntryId),
    // Links are read from both ends: symmetric relations union the two
    // directions, and an asymmetric one still shows on the far entry.
    index("entry_link_to_idx").on(table.toEntryId),
  ],
);

export const entryPhoto = sqliteTable(
  "entry_photo",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id")
      .notNull()
      .references(() => entry.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    caption: text("caption"),
    position: integer("position").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("entry_photo_entryId_position_idx").on(table.entryId, table.position),
  ],
);

export const entryVisit = sqliteTable(
  "entry_visit",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id")
      .notNull()
      .references(() => entry.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // An ISO date, not a timestamp: a visit is a day, and one recalled from
    // memory should not pretend to a time zone.
    visitedOn: text("visited_on").notNull(),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    unique("entry_visit_unq").on(table.entryId, table.userId, table.visitedOn),
    index("entry_visit_entryId_idx").on(table.entryId),
    index("entry_visit_userId_idx").on(table.userId),
  ],
);

export const entryRelations = relations(entry, ({ one, many }) => ({
  owner: one(user, {
    fields: [entry.userId],
    references: [user.id],
  }),
  location: one(locationDetail, {
    fields: [entry.id],
    references: [locationDetail.entryId],
  }),
  activity: one(activityDetail, {
    fields: [entry.id],
    references: [activityDetail.entryId],
  }),
  photos: many(entryPhoto),
  visits: many(entryVisit),
}));

export const locationDetailRelations = relations(locationDetail, ({ one }) => ({
  entry: one(entry, {
    fields: [locationDetail.entryId],
    references: [entry.id],
  }),
  type: one(entryType, {
    fields: [locationDetail.typeId],
    references: [entryType.id],
  }),
}));

export const activityDetailRelations = relations(activityDetail, ({ one }) => ({
  entry: one(entry, {
    fields: [activityDetail.entryId],
    references: [entry.id],
  }),
  type: one(entryType, {
    fields: [activityDetail.typeId],
    references: [entryType.id],
  }),
}));

export const entryPhotoRelations = relations(entryPhoto, ({ one }) => ({
  entry: one(entry, {
    fields: [entryPhoto.entryId],
    references: [entry.id],
  }),
}));

export const entryVisitRelations = relations(entryVisit, ({ one }) => ({
  entry: one(entry, {
    fields: [entryVisit.entryId],
    references: [entry.id],
  }),
  user: one(user, {
    fields: [entryVisit.userId],
    references: [user.id],
  }),
}));
