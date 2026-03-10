import { NextRequest, NextResponse } from "next/server";
import { listEntries, upsertEntry } from "@/lib/vault";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const q = (req.nextUrl.searchParams.get("q") || "").toLowerCase();
  let entries = await listEntries();

  if (projectId) {
    entries = entries.filter((entry) => entry.projectId === projectId);
  }

  if (q) {
    entries = entries.filter((entry) =>
      [entry.name, entry.key, entry.value, entry.description || "", entry.type, entry.project || "", entry.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }

  return NextResponse.json(entries);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const entry = await upsertEntry({
    id: body.id,
    name: body.name,
    key: body.key,
    type: body.type,
    secretType: body.secretType,
    value: body.value,
    description: body.description,
    project: body.project,
    projectId: body.projectId,
    tags: body.tags || [],
    favorite: !!body.favorite,
    includeInEnv: body.includeInEnv ?? true,
  });
  return NextResponse.json(entry);
}
