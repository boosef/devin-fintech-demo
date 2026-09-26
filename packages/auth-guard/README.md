# @acme/auth-guard

Every app in this monorepo checks role-based access through this package instead
of writing its own auth logic.

```ts
import { getMockUser, hasRole } from "@acme/auth-guard";

const user = getMockUser(request);
if (!hasRole(user, ["admin", "reviewer"])) {
  return new Response("forbidden", { status: 403 });
}
```

## API

- `getMockUser(request: Request): MockUser | null`
  - returns `null` unless `process.env.MOCK_AUTH_ENABLED === "true"` (a hard
    off-switch: mock auth cannot work in an environment that has not opted in)
  - reads the role from `x-mock-role` and the id from `x-mock-user-id`
  - returns `null` if either header is missing or the role is not `"admin"` or
    `"reviewer"`
  - `email` is `` `${id}@example.test` ``
- `hasRole(user: MockUser | null, allowed: Role[]): boolean` — `false` for a
  null user and for an empty allow list.

## Production

Production would validate a real JWT or session against Entra ID (or
equivalent) and derive roles from IdP group claims. **None of that is
implemented here**: there is no token validation, no expiry or revocation, and
no IdP group-to-role mapping. The headers above are trusted as-is whenever the
env flag is on, which is acceptable only for a local POC.
