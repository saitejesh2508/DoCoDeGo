PRAGMA foreign_keys = ON;

CREATE TABLE homes (
  id TEXT NOT NULL CONSTRAINT homes_pk PRIMARY KEY,
  name TEXT NOT NULL CONSTRAINT homes_name_nonempty CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE members (
  id TEXT NOT NULL CONSTRAINT members_pk PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL CONSTRAINT members_name_nonempty CHECK (length(trim(name)) > 0),
  position INTEGER NOT NULL CONSTRAINT members_position_nonnegative CHECK (position >= 0),
  created_at TEXT NOT NULL,
  CONSTRAINT members_home_position_unique UNIQUE (home_id, position),
  CONSTRAINT members_home_fk FOREIGN KEY (home_id) REFERENCES homes (id) ON DELETE CASCADE
);

CREATE INDEX members_by_home_order ON members (home_id, position);

CREATE TABLE bills (
  id TEXT NOT NULL CONSTRAINT bills_pk PRIMARY KEY,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL CONSTRAINT bills_title_nonempty CHECK (length(trim(title)) > 0),
  total_cents INTEGER NOT NULL CONSTRAINT bills_total_positive CHECK (
    typeof(total_cents) = 'integer' AND total_cents > 0
  ),
  position INTEGER NOT NULL CONSTRAINT bills_position_nonnegative CHECK (position >= 0),
  created_at TEXT NOT NULL,
  CONSTRAINT bills_home_position_unique UNIQUE (home_id, position),
  CONSTRAINT bills_home_fk FOREIGN KEY (home_id) REFERENCES homes (id) ON DELETE CASCADE
);

CREATE INDEX bills_by_home_order ON bills (home_id, position);

CREATE TABLE shares (
  id TEXT NOT NULL CONSTRAINT shares_pk PRIMARY KEY,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CONSTRAINT shares_amount_nonnegative CHECK (
    typeof(amount_cents) = 'integer' AND amount_cents >= 0
  ),
  paid_at TEXT,
  idempotency_key TEXT CONSTRAINT shares_idempotency_key_unique UNIQUE,
  CONSTRAINT shares_bill_member_unique UNIQUE (bill_id, member_id),
  CONSTRAINT shares_bill_fk FOREIGN KEY (bill_id) REFERENCES bills (id) ON DELETE CASCADE,
  CONSTRAINT shares_member_fk FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
);

CREATE INDEX shares_by_member_payment ON shares (member_id, paid_at);
CREATE INDEX shares_by_bill ON shares (bill_id);

CREATE TRIGGER shares_member_must_belong_to_bill_home
BEFORE INSERT ON shares
WHEN (
  SELECT home_id FROM bills WHERE id = NEW.bill_id
) IS NOT (
  SELECT home_id FROM members WHERE id = NEW.member_id
)
BEGIN
  SELECT RAISE(ABORT, 'share member must belong to bill home');
END;
