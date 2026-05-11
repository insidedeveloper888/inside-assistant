import { AppShell } from "@/components/app-shell/app-shell";
import { getShellData } from "@/lib/app-shell-data";
import { redirect } from "next/navigation";

export default async function WhatsAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, sessions, ctx } = await getShellData();
  if (ctx.role !== "director") redirect("/");
  return (
    <AppShell user={user} sessions={sessions}>
      {children}
    </AppShell>
  );
}
