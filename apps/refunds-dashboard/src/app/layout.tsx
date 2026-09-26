import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { ViewingAs } from "@/components/viewing-as";
import { getCurrentUser } from "@/lib/auth/current-user";

import "./globals.css";

export const metadata: Metadata = {
  title: "Refunds review",
  description: "Internal refunds review dashboard (POC)",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="brand">
            Refunds review <span className="poc">POC</span>
          </div>
          <nav>
            <Link href="/refunds">Requests</Link>
            <Link href="/audit">Audit trail</Link>
          </nav>
          <div className="whoami">
            {user ? (
              <>
                Signed in as <strong>{user.id}</strong> ({user.role})
              </>
            ) : (
              <>Not signed in</>
            )}
          </div>
          {process.env.NODE_ENV !== "production" && <ViewingAs user={user} />}
        </header>
        <main>{children}</main>
        <footer className="footer">Synthetic demo data only. No real customers, payments or money movement.</footer>
      </body>
    </html>
  );
}
