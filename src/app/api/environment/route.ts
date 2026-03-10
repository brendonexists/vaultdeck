import { NextResponse } from "next/server";
import { envStatus } from "@/lib/vault";

export async function GET() {
  return NextResponse.json(await envStatus());
}
