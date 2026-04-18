"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface SessionItem {
  id: string;
  title: string;
  mode: string;
  updated_at: string;
}

interface SessionContextType {
  sessions: SessionItem[];
  setSessions: (sessions: SessionItem[]) => void;
  updateSessionTitle: (id: string, title: string) => void;
  addSession: (session: SessionItem) => void;
}

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({
  children,
  initialSessions,
}: {
  children: ReactNode;
  initialSessions: SessionItem[];
}) {
  const [sessions, setSessions] = useState<SessionItem[]>(initialSessions);

  const updateSessionTitle = useCallback((id: string, title: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title } : s))
    );
  }, []);

  const addSession = useCallback((session: SessionItem) => {
    setSessions((prev) => [session, ...prev]);
  }, []);

  return (
    <SessionContext.Provider value={{ sessions, setSessions, updateSessionTitle, addSession }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessions() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSessions must be used within SessionProvider");
  return ctx;
}
