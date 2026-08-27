import { NextResponse } from "next/server";
import { createAuthClient } from "@/lib/supabase-server";

/**
 * Sign out. POST only -- a GET would let any link or prefetch log you out.
 */
export async function POST(request) {
  const supabase = await createAuthClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
