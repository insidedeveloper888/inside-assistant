const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";

// Team hierarchy mapping — name → tier + role
const HIERARCHY: Record<string, { tier: string; role: "director" | "manager" | "member" }> = {
  "ck chia": { tier: "L1 Founder", role: "director" },
  "kg": { tier: "L2 Executive", role: "director" },
  "celia": { tier: "L2-L3 COO", role: "manager" },
  "jim": { tier: "L3 Manager", role: "manager" },
  "jacky tok": { tier: "L4 Supervisor", role: "member" },
  "simon": { tier: "L4 Supervisor", role: "member" },
  "sh": { tier: "L4 Supervisor", role: "member" },
  "lee chen wei": { tier: "L5 Operator", role: "member" },
  "jia hao": { tier: "L5 Bookkeeper", role: "member" },
  "tong xin lim": { tier: "L5 Operator", role: "member" },
  "ling zhong yu": { tier: "L5 Operator", role: "member" },
};

export async function getLarkToken(): Promise<string | null> {
  if (!LARK_APP_ID || !LARK_APP_SECRET) return null;
  try {
    const res = await fetch("https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return data.tenant_access_token ?? null;
  } catch {
    return null;
  }
}

export interface LarkUser {
  name: string;
  enName: string;
  openId: string;
  email: string;
  tier: string;
  role: "director" | "manager" | "member";
}

export async function findLarkUserByEmail(email: string): Promise<LarkUser | null> {
  const token = await getLarkToken();
  if (!token) return null;

  // Search all departments for a user with this email
  for (const deptId of ["0", "877d824dgf79263a"]) {
    try {
      const res = await fetch(
        `https://open.larksuite.com/open-apis/contact/v3/users/find_by_department?department_id=${deptId}&page_size=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      const users = data.data?.items ?? [];

      for (const u of users) {
        if (u.email?.toLowerCase() === email.toLowerCase()) {
          const name = u.name ?? u.en_name ?? "";
          const nameLower = name.toLowerCase();
          const hierarchy = HIERARCHY[nameLower] ?? { tier: "L5 Operator", role: "member" as const };

          return {
            name: u.name ?? "",
            enName: u.en_name ?? "",
            openId: u.open_id ?? "",
            email: u.email ?? "",
            tier: hierarchy.tier,
            role: hierarchy.role,
          };
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function findAllLarkUsers(): Promise<LarkUser[]> {
  const token = await getLarkToken();
  if (!token) return [];

  const allUsers: LarkUser[] = [];
  for (const deptId of ["0", "877d824dgf79263a"]) {
    try {
      const res = await fetch(
        `https://open.larksuite.com/open-apis/contact/v3/users/find_by_department?department_id=${deptId}&page_size=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      const users = data.data?.items ?? [];

      for (const u of users) {
        if (u.status?.is_resigned) continue;
        const name = u.name ?? u.en_name ?? "";
        const nameLower = name.toLowerCase();
        const hierarchy = HIERARCHY[nameLower] ?? { tier: "L5 Operator", role: "member" as const };

        allUsers.push({
          name: u.name ?? "",
          enName: u.en_name ?? "",
          openId: u.open_id ?? "",
          email: u.email ?? "",
          tier: hierarchy.tier,
          role: hierarchy.role,
        });
      }
    } catch {
      continue;
    }
  }
  return allUsers;
}
