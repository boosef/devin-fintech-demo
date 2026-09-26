import type { MockUser } from "@acme/auth-guard";

import { setViewingAs } from "@/lib/auth/viewing-as";

export function ViewingAs({ user }: { user: MockUser | null }) {
  return (
    <form action={setViewingAs} className="viewing-as">
      <label htmlFor="persona">
        Viewing as <span className="dev-badge">dev only</span>
      </label>
      <select id="persona" name="persona" defaultValue={user?.role ?? "none"}>
        <option value="reviewer">Reviewer (demo-reviewer)</option>
        <option value="admin">Admin (demo-admin)</option>
        <option value="none">No role</option>
      </select>
      <input type="hidden" name="returnTo" value="/refunds" />
      <button type="submit" className="btn">
        Switch
      </button>
    </form>
  );
}
