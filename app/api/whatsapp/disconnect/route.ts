import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    { error: "WhatsApp is shared with WA Analyzer. Disconnect from WA Analyzer dashboard instead." },
    { status: 400 }
  );
}
