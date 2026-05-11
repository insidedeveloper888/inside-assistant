import { AppShell } from "@/components/app-shell/app-shell";
import { getShellData } from "@/lib/app-shell-data";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, sessions, ctx } = await getShellData();
  // Director gate at the layout level — every /admin/* page is director-only.
  // Individual pages can still do their own deeper checks (e.g. specific
  // capabilities) but the broad rule lives here.
  if (ctx.role !== "director") redirect("/");
  return (
    <AppShell user={user} sessions={sessions}>
      {children}
    </AppShell>
  );
}
