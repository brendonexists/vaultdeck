import { NextRequest, NextResponse } from "next/server";
import { deleteEntry, listEntries, upsertEntry } from "@/lib/vault";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string; secretId: string }> }) {
  const body = await req.json();
  const { id, secretId } = await ctx.params;
  const existing = (await listEntries()).find((entry) => entry.id === secretId && entry.projectId === id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const secret = await upsertEntry({
    id: secretId,
    name: body.name ?? existing.name,
    key: body.key ?? existing.key,
    type: body.type ?? existing.type,
    secretType: body.secretType ?? existing.secretType,
    value: body.value ?? existing.value,
    description: body.description ?? existing.description,
    projectId: id,
    tags: body.tags ?? existing.tags,
    favorite: body.favorite ?? existing.favorite,
    includeInEnv: body.includeInEnv ?? existing.includeInEnv,
    createdAt: existing.createdAt,
  });

  return NextResponse.json(secret);
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string; secretId: string }> }) {
  const { secretId } = await ctx.params;
  await deleteEntry(secretId);
  return NextResponse.json({ ok: true });
}
