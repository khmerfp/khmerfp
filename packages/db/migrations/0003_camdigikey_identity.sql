ALTER TABLE users
  ADD COLUMN camdigikey_sub VARCHAR(255),
  ADD COLUMN identity_verified_at TIMESTAMPTZ;
--> statement-breakpoint
CREATE UNIQUE INDEX users_camdigikey_sub_key
  ON users (camdigikey_sub);
