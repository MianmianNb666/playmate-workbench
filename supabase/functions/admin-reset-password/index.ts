import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://mianmiannb666.github.io",
  "https://playmate-workbench.vercel.app"
]);

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://mianmiannb666.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
}

function json(origin: string, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin)
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return json(origin, { error: "method_not_allowed" }, 405);
  }

  if (!ALLOWED_ORIGINS.has(origin)) {
    return json(origin, { error: "origin_not_allowed" }, 403);
  }

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(origin, { error: "missing_admin_session" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  let publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const publishableJson = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (publishableJson) {
    try {
      publishableKey = JSON.parse(publishableJson).default || publishableKey;
    } catch {}
  }

  let secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const secretJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretJson) {
    try {
      secretKey = JSON.parse(secretJson).default || secretKey;
    } catch {}
  }

  if (!supabaseUrl || !publishableKey || !secretKey) {
    return json(origin, {
      error: "edge_function_not_configured",
      message: "Supabase Edge Function 缺少项目密钥环境变量"
    }, 500);
  }

  const caller = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: isAdmin, error: adminError } = await caller.rpc("is_app_admin");
  if (adminError) {
    return json(origin, {
      error: "admin_check_failed",
      message: adminError.message
    }, 403);
  }

  if (isAdmin !== true) {
    return json(origin, { error: "admin_required", message: "当前账号没有管理权限" }, 403);
  }

  let body: { user_id?: string; new_password?: string };
  try {
    body = await req.json();
  } catch {
    return json(origin, { error: "invalid_json" }, 400);
  }

  const userId = String(body?.user_id || "").trim();
  const newPassword = String(body?.new_password || "");

  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    return json(origin, { error: "invalid_user_id" }, 400);
  }

  if (newPassword.length < 6) {
    return json(origin, { error: "password_too_short", message: "新密码至少 6 位" }, 400);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password: newPassword
  });

  if (updateError) {
    return json(origin, {
      error: "password_update_failed",
      message: updateError.message
    }, 400);
  }

  return json(origin, { success: true });
});
