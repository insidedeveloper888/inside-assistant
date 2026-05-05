import { createClient } from "@supabase/supabase-js";
import { searchVectorMemories } from "../lib/vector-memory.js";

async function main() {
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const queries = [
    "e-ticketing system",
    "Internal-Eticketing github",
    "CK Chia Ticketing",
    "do we have an e-ticketing system?",
  ];

  for (const q of queries) {
    console.log(`\n=== Query: "${q}" ===`);
    const results = await searchVectorMemories(admin, { query: q, scope: "company", limit: 3 });
    for (const r of results) {
      console.log(`  [sim=${r.similarity?.toFixed(3)} kw=${r.keyword_rank?.toFixed(3)}] ${r.content.slice(0, 100).replace(/\n/g, " ")}`);
    }
  }
}

main().catch(console.error);
