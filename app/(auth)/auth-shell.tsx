import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { AuthShowcase } from "./auth-showcase";
import styles from "./auth.module.css";

/** Split-screen frame for the auth pages: the form on one side, a living city preview on the other. */
export function AuthShell({ mode, children }: { mode: "sign-in" | "sign-up"; children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <main className={styles.formSide}>
        <header className={styles.brandRow}>
          <Link href="/" className={styles.brand}>
            <BrandMark />
            <span>Creator City</span>
          </Link>
        </header>
        <div className={styles.formWrap}>{children}</div>
        <footer className={styles.footer}>
          Your agents, your city. Built for creators who ship every day.
        </footer>
      </main>
      <AuthShowcase mode={mode} />
    </div>
  );
}
