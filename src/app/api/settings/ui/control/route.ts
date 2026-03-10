import { NextRequest, NextResponse } from "next/server";
import { controlUi, getUiRuntimeStatus } from "@/lib/ui-control";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action !== "start" && action !== "stop" && action !== "restart") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  controlUi(action);
  const runtime = await getUiRuntimeStatus();
  return NextResponse.json({ ok: true, action, runtime, note: "Command scheduled" });
}
