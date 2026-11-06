import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  inet,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

// store user accounts and sign-in methods
export const users = pgTable(
  'users',
  {
    id: bigint('id', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    googleSub: varchar('google_sub', { length: 255 }),
    email: varchar('email', { length: 320 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    avatarUrl: text('avatar_url'),
    language: varchar('language', { length: 5 })
      .default('en')
      .notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastLoginIp: inet('last_login_ip'),
    lastLoginUserAgent: text('last_login_user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    passwordHash: text('password_hash'),
    facebookSub: varchar('facebook_sub', { length: 255 }),
    telegramSub: varchar('telegram_sub', { length: 255 }),
    phoneNumber: varchar('phone_number', { length: 32 }),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
  },
  (table) => [
    
    // keep each linked identity unique
    unique('users_google_sub_key').on(table.googleSub),
    check(
      'users_language_check',
      sql`${table.language} IN ('en', 'km')`,
    ),

    // speed up account lookup and prevent duplicates
    uniqueIndex('idx_users_email_unique').on(table.email),
    uniqueIndex('idx_users_facebook_sub_unique')
      .on(table.facebookSub)
      .where(sql`${table.facebookSub} IS NOT NULL`),
    uniqueIndex('idx_users_telegram_sub_unique')
      .on(table.telegramSub)
      .where(sql`${table.telegramSub} IS NOT NULL`),
    uniqueIndex('idx_users_phone_number_unique')
      .on(table.phoneNumber)
      .where(sql`${table.phoneNumber} IS NOT NULL`),
  ],
)
