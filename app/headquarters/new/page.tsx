import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { getCurrentUser } from "@/lib/auth/session";
import { findHeadquarters, HEADQUARTERS_NAME_MAX } from "@/lib/headquarters";
import { HeadquartersForm } from "./headquarters-form";
import styles from "./headquarters.module.css";

export const metadata: Metadata = { title: "Create your headquarters — Creator City" };

/** Onboarding: every signed-in user without a headquarters lands here before the dashboard. */
export default async function NewHeadquartersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (await findHeadquarters(user.email)) redirect("/dashboard");

  const firstName = user.name?.trim().split(/\s+/)[0];
  const suggestedName = (firstName ? `${firstName}'s HQ` : "Creator HQ").slice(0, HEADQUARTERS_NAME_MAX);

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <Link href="/" className={styles.brand}>
          <BrandMark />
          <span>Creator City</span>
        </Link>
        <span className={styles.step}>Setup · Headquarters</span>
      </header>
      <HeadquartersForm suggestedName={suggestedName} nameMax={HEADQUARTERS_NAME_MAX} />
    </div>
  );
}
