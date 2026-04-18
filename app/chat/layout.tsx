import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { redirect } from "next/navigation";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { SessionProvider } from "@/components/chat/session-context";

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Fetch user sessions
  const { data: sessions } = await admin
    .from("assistant_sessions")
    .select("id, title, mode, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  // Fetch or create user settings
  const { data: settings } = await admin
    .from("assistant_user_settings")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!settings) {
    await admin.from("assistant_user_settings").insert({
      user_id: user.id,
      display_name: user.email?.split("@")[0] ?? "",
      role: "member",
    });
  }

  return (
    <SessionProvider initialSessions={sessions ?? []}>
      <div className="flex h-screen overflow-hidden">
        <ChatSidebar
          userEmail={user.email ?? ""}
          displayName={settings?.display_name || user.email?.split("@")[0] || ""}
          userRole={settings?.role || "member"}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </SessionProvider>
  );
}
