export function AccessRequired() {
  return (
    <section className="panel notice" role="status">
      <h2>Reviewer or admin role required</h2>
      <p>
        Refund requests, approve/deny and the audit trail are only available to the <code>reviewer</code> and{" "}
        <code>admin</code> roles. In development, pick a role with the &ldquo;Viewing as&rdquo; selector above.
      </p>
    </section>
  );
}
