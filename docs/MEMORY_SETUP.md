# WhiteDevil v5.1 — D1 conversation history

## Deployment gate (do not skip)

This feature is intentionally **fail-closed** until the Worker secret below is set.
The existing Cloudflare Access application and Workers AI backend remain unchanged.

### Database

- Binding: `DB`
- Database: `whitedevil-memory-v51`
- Migration: `migrations/0001_conversations.sql`
- Schema has already been applied to the remote D1 database on 2026-10-14.
- Running the migration again is harmless because the table and index use `IF NOT EXISTS`.

### Authentication

The Worker validates the RSA signature, expiry, issuer, Access app audience, and approved owner's email on each `/api/history` request. The browser never supplies a trusted owner ID.

Non-secret public Wrangler configuration:
- `ACCESS_TEAM_DOMAIN` — Cloudflare Access organization URL.
- `ACCESS_AUD` — **custom-domain** Access app AUD for `ai.whitedevil.my`.

**Required secret (not in GitHub):**

- `MEMORY_OWNER_EMAIL`: the single email approved by the `WhiteDevil - Owner Only` policy.
- Add through Cloudflare Worker **Settings > Variables and Secrets** as type **Secret**, or with `wrangler secret put MEMORY_OWNER_EMAIL`.
- Do not commit this value into GitHub.
- A missing or incorrect secret makes history endpoints return 401 rather than leak any data.

`workers.dev` and preview hosts may use a *different* Cloudflare Access app audience. Memory intentionally fails closed there until separate audience support is reviewed. The main chat remains usable.

### Review checklist

1. Ensure the build passes, and review the PR diff before merging.
2. Confirm the D1 `DB` binding and the owner-email secret exist in the relevant Worker environment.
3. Check the custom hostname still requires Cloudflare login, and that a different email is denied.
4. After merging to production, test a new conversation, reload the page, reopen history, and delete a test conversation.
5. Confirm unauthenticated history calls return 401 or a Cloudflare Access login page.
6. Verify another Cloudflare identity cannot read or delete another user's history.

### Data and costs

- Stores plain-text conversation history in Cloudflare D1; do not save passwords, private keys, or sensitive third-party project files.
- Up to 60 conversations per verified user and up to 80 messages per conversation.
- The browser autosaves only after a complete assistant reply. If saving fails, chat continues and the UI reports that history was not saved.
- Free-tier quota is subject to Cloudflare's daily row read/write and storage limits. If reached, D1 requests fail until the limit resets.
- There is no automatic data retention expiration. The user can delete each conversation.
- History is **not** a system-prompt memory or persistent AI persona. When reopened, recent context is sent back to the existing AI model.

### Important

Do not activate production memory until its owner-email secret is configured. Avoid auto-merging.
