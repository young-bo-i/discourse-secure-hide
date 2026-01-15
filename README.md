# Discourse Secure Hide

Hide portions of a post behind a lock. The hidden HTML is not shipped in the post’s cooked HTML (or the raw endpoints) until the viewer unlocks it via configured actions.

## Enable

- Admin → Site Settings → set `secure_hide_enabled` to true

## Authoring (hide part of a post)

Use the composer toolbar option **Secure hide** (lock icon), or insert BBCode manually:

```
[secure_hide mode=any actions=like,reply]
This text is hidden.
[/secure_hide]
```

- `actions`: `like`, `reply` (comma-separated)
- `mode`: `any` (default) or `all`

## Viewer experience

- Anonymous users and locked users see a placeholder.
- Post author and staff always see the hidden content, with a notice explaining why.
- Unlocking is per-user and per-post, persisted in `secure_hide_unlocks` (it does not reset by default).

## Security notes

- Hidden content is extracted server-side during cooking and stored in a post custom field.
- It is returned only via `GET /secure-hide/posts/:post_id.json` after permission + unlock checks.
