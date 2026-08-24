# AI Key Write-Only Configuration Design

## Goal

Keep the configured AI API key entirely server-side while allowing an authenticated administrator to replace it.

## Decisions

- `ai_provider`, `ai_model`, and `ai_base_url` remain normal admin-editable configuration values.
- `ai_api_key` is never returned to any client role, including administrators.
- A dedicated authenticated Edge Function accepts a replacement key, verifies the caller is an administrator using the service-role client, and writes the key server-side.
- The admin application loads only non-secret configuration plus an `isConfigured` indicator. It displays no prior key value.
- The scoring Edge Function continues to retrieve the API key with its service-role client.

## Request Flow

1. An administrator loads AI settings and receives provider, model, base URL, and whether a key exists.
2. To replace a key, the administrator submits a non-empty value to the key-management Edge Function.
3. The function authenticates the JWT, checks `profiles.is_admin`, upserts `ai_api_key`, and returns `{ configured: true }`.
4. The client clears the input and refreshes non-secret configuration.

## Error Handling

- Missing or invalid JWT: `401`.
- Authenticated non-admin: `403`.
- Missing or blank key: `400`.
- Database failures: generic `500` response with detailed server logging only.

## Verification

- Non-admin reads cannot return `ai_api_key`.
- Admin reads cannot return `ai_api_key`.
- A non-admin cannot replace the key.
- An admin can replace the key and score answers without the key appearing in client responses.
