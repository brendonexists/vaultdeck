import { NextResponse } from "next/server";
import { generateEnvFiles } from "@/lib/vault";

export async function POST() {
  return NextResponse.json(await generateEnvFiles());
}
