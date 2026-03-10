import { NextRequest, NextResponse } from "next/server";
import { deleteEntry, listEntries, upsertEntry } from "@/lib/vault";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = await req.json();
  const { id } = await ctx.params;
  const entry = await upsertEntry({
    id,
    name: body.name,
    key: body.key,
    type: body.type,
    value: body.value,
    description: body.description,
    project: body.project,
    tags: body.tags || [],
    favorite: !!body.favorite,
    includeInEnv: body.includeInEnv ?? true,
    createdAt: body.createdAt,
  });
  return NextResponse.json(entry);
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteEntry(id);
  return NextResponse.json({ ok: true });
}

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const entry = (await listEntries()).find((e) => e.id === id);
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(entry);
}
