import { AppShell } from "@/components/app-shell/app-shell";
import { getShellData } from "@/lib/app-shell-data";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, sessions } = await getShellData();
  return (
    <AppShell user={user} sessions={sessions}>
      {children}
    </AppShell>
  );
}
