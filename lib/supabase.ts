import { createClient, type SupabaseClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && key);
let client: SupabaseClient | undefined;
export function supabase() {
  if (!url || !key) throw new Error("请先配置 Supabase，再登录使用。");
  if (key.startsWith("sb_secret_"))
    throw new Error("配置错误：前端只能使用 publishable / anon key。");
  return (client ??= createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }));
}
export function friendlyError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String(error.message)
        : "操作失败，请重试。";
  if (/invalid login credentials/i.test(message))
    return "邮箱或密码不正确，请检查后重试。";
  if (/fetch|network|load failed/i.test(message))
    return "网络连接失败。内容尚未确认保存，请联网后重试。";
  if (/email not confirmed/i.test(message))
    return "邮箱尚未验证，请联系此衣橱的管理员确认账号。";
  if (/JWT|session.*expired/i.test(message)) return "登录已过期，请重新登录。";
  return message;
}
