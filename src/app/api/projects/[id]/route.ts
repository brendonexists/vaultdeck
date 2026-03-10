import { NextRequest, NextResponse } from "next/server";
import { deleteProject, listProjects, upsertProject } from "@/lib/vault";

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const project = (await listProjects()).find((p) => p.id === id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = await req.json();
  const { id } = await ctx.params;
  const project = await upsertProject({
    id,
    name: body.name,
    description: body.description,
    color: body.color || "#7c3aed",
    icon: body.icon || "◈",
  });
  return NextResponse.json(project);
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteProject(id);
  return NextResponse.json({ ok: true });
}
