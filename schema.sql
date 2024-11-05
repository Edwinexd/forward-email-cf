DROP TABLE IF EXISTS aliases;
CREATE TABLE aliases (
    alias TEXT NOT NULL,
    domain TEXT NOT NULL,
    created_at TEXT NOT NULL,
    active INTEGER NOT NULL,
    hostname TEXT NULL,
    PRIMARY KEY (alias, domain)
);

CREATE INDEX idx_hostname ON aliases (hostname);
