import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { ChatSidebar } from "@/components/chat/chat-sidebar";

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

  // Fetch user sessions
  const { data: sessions } = await supabase
    .from("assistant_sessions")
    .select("id, title, mode, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  // Fetch or create user settings
  const { data: settings } = await supabase
    .from("assistant_user_settings")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!settings) {
    await supabase.from("assistant_user_settings").insert({
      user_id: user.id,
      display_name: user.email?.split("@")[0] ?? "",
      role: "member",
    });
  }

  return (
    <div className="flex h-screen">
      <ChatSidebar
        sessions={sessions ?? []}
        userEmail={user.email ?? ""}
        displayName={settings?.display_name || user.email?.split("@")[0] || ""}
        userRole={settings?.role || "member"}
      />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
