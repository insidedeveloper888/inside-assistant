export default function ChatIndexPage() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center space-y-3">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10">
          <span className="text-3xl">🧠</span>
        </div>
        <h2 className="text-lg font-semibold text-zinc-200">Inside Assistant</h2>
        <p className="text-sm text-zinc-500 max-w-xs">
          Start a new chat or select an existing session from the sidebar.
        </p>
      </div>
    </div>
  );
}
