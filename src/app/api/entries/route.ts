import { NextRequest, NextResponse } from "next/server";
import { listEntries, upsertEntry } from "@/lib/vault";

export async function GET() {
  const entries = await listEntries();
  return NextResponse.json(entries);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const entry = await upsertEntry({
    id: body.id,
    name: body.name,
    key: body.key,
    type: body.type,
    value: body.value,
    description: body.description,
    project: body.project,
    tags: body.tags || [],
    favorite: !!body.favorite,
    includeInEnv: body.includeInEnv ?? true,
  });
  return NextResponse.json(entry);
}
