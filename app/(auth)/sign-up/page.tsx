import type { Metadata } from "next";
import { AuthForm } from "../auth-form";
import { AuthShell } from "../auth-shell";

export const metadata: Metadata = { title: "Sign up — Creator City" };

export default function SignUpPage() {
  return (
    <AuthShell mode="sign-up">
      <AuthForm mode="sign-up" />
    </AuthShell>
  );
}
