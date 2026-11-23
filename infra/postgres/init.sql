-- Separate database for integration tests so `pnpm test:integration` never touches dev data.
CREATE DATABASE opsdesk_test OWNER opsdesk;
