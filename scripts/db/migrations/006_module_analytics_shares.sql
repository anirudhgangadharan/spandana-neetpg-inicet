create table faculty_module_analytics_shares (
  module_id uuid primary key references faculty_modules(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz
);
