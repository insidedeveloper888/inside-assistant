import { SessionProvider } from "@/components/chat/session-context";
import { AppShell } from "@/components/app-shell/app-shell";
import { getShellData } from "@/lib/app-shell-data";

/**
 * Chat layout — wraps in AppShell (persistent app nav) AND SessionProvider
 * (so chat pages can read/mutate the sessions list optimistically). The
 * SessionProvider's `initialSessions` comes from the same fetch the shell
 * uses, so we don't double-query.
 */
export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, sessions } = await getShellData();
  return (
    <SessionProvider initialSessions={sessions}>
      <AppShell user={user} sessions={sessions}>
        {children}
      </AppShell>
    </SessionProvider>
  );
}
