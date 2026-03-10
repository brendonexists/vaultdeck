import { NextRequest, NextResponse } from "next/server";
import { deleteFile, listFiles, renameFile } from "@/lib/vault";

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const file = (await listFiles()).find((f) => f.id === id);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(file);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const file = await renameFile(id, body.originalName);
  return NextResponse.json(file);
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteFile(id);
  return NextResponse.json({ ok: true });
}
