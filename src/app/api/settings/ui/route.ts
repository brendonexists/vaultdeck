import { NextRequest, NextResponse } from "next/server";
import { getUiRuntimeStatus, getUiSettings, setUiSettings } from "@/lib/ui-control";

export const runtime = "nodejs";

export async function GET() {
  const [settings, runtime] = await Promise.all([getUiSettings(), getUiRuntimeStatus()]);
  return NextResponse.json({ settings, runtime });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const settings = await setUiSettings({
    host: body?.host,
    port: body?.port,
  });
  const runtime = await getUiRuntimeStatus();
  return NextResponse.json({ settings, runtime });
}
