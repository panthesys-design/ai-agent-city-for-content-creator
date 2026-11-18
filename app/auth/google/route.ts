import { NextResponse, type NextRequest } from "next/server";
import { googleSignInUrl } from "@/lib/auth/cloudhike";

// Starts Google sign-in. CloudHike sends the browser back to /auth/callback with the token in the URL fragment.
export function GET(request: NextRequest) {
  return NextResponse.redirect(googleSignInUrl(`${request.nextUrl.origin}/auth/callback`));
}
