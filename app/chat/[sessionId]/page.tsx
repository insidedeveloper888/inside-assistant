import { createClient } from "@/lib/supabase-server";
import { redirect, notFound } from "next/navigation";
import { ChatWindow } from "@/components/chat/chat-window";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Verify session belongs to user
  const { data: session } = await supabase
    .from("assistant_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .single();

  if (!session) notFound();

  // Fetch messages
  const { data: messages } = await supabase
    .from("assistant_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  // Fetch user settings (claude_md)
  const { data: settings } = await supabase
    .from("assistant_user_settings")
    .select("claude_md, display_name, role")
    .eq("user_id", user.id)
    .single();

  return (
    <ChatWindow
      session={session}
      initialMessages={messages ?? []}
      userId={user.id}
      displayName={settings?.display_name || user.email?.split("@")[0] || ""}
      claudeMd={settings?.claude_md || ""}
      userRole={settings?.role || "member"}
    />
  );
}
