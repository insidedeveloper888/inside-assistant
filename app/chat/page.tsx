export default function ChatIndexPage() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-md space-y-4 text-center">
        <div
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold text-white"
          style={{
            background: "linear-gradient(135deg, #FB923C 0%, #F97316 50%, #EA580C 100%)",
            letterSpacing: "-0.04em",
            boxShadow: "0 8px 24px rgb(249 115 22 / 0.3)",
          }}
        >
          IA
        </div>
        <div className="space-y-1.5">
          <h2 className="text-xl font-semibold tracking-tight">Inside Assistant</h2>
          <p className="text-sm text-muted-foreground">
            Start a new chat or pick a session from the sidebar. Press{" "}
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
              ⌘K
            </kbd>{" "}
            to jump anywhere.
          </p>
        </div>
      </div>
    </div>
  );
}
