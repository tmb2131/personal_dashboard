import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getNotionDataVersion } from "@/lib/sync/data-version";

export const dynamic = "force-dynamic";

// Cheap DB-only probe: lets an open tab notice Notion writes that arrived by
// webhook without any tab calling the Notion API.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });

  try {
    const version = await getNotionDataVersion();
    return NextResponse.json({ ok: true, version });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
