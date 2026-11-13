import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

const DEFAULT_ADMIN_EMAIL = "xhieupeo@gmail.com";

/**
 * Initializes or updates the master admin account in Supabase
 * using the server service role key with email_confirm: true.
 * Accepts password dynamically from the request body or from process.env.ADMIN_SETUP_PASSWORD.
 * Never hardcodes plaintext passwords in the codebase.
 */
export async function POST(req: NextRequest) {
  try {
    let password = process.env.ADMIN_SETUP_PASSWORD || "";
    let email = DEFAULT_ADMIN_EMAIL;

    try {
      const body = await req.json();
      if (body.password) password = String(body.password);
      if (body.email) email = String(body.email).trim().toLowerCase();
    } catch {
      // Body is optional if process.env.ADMIN_SETUP_PASSWORD is set
    }

    if (!password) {
      return NextResponse.json(
        {
          error:
            "Password is required. Provide it in the request body as JSON { password: '...' } or set ADMIN_SETUP_PASSWORD in environment variables.",
        },
        { status: 400 }
      );
    }

    const supabase = getServerSupabase();
    if (!supabase) {
      return NextResponse.json(
        {
          error:
            "Supabase credentials not found. Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.",
        },
        { status: 503 }
      );
    }

    // 1. List existing users in auth.users
    const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      console.error("List users error:", listError);
      return NextResponse.json({ error: listError.message }, { status: 500 });
    }

    const existingUsers = listData?.users || [];
    const targetUser = existingUsers.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );

    if (targetUser) {
      // 2A. Update existing user's password and confirm email
      const { data: updated, error: updateError } =
        await supabase.auth.admin.updateUserById(targetUser.id, {
          password,
          email_confirm: true,
        });

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        status: "UPDATED",
        email,
        message: `Admin account '${email}' password successfully synchronized and verified.`,
      });
    }

    // 2B. Create new confirmed admin user
    const { data: created, error: createError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      status: "CREATED",
      email,
      message: `Admin account '${email}' created and auto-verified successfully.`,
    });
  } catch (err: any) {
    console.error("Setup admin exception:", err);
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
