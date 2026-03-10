import { NextRequest, NextResponse } from "next/server";
import {
  deleteProject,
  exportProjectVariables,
  getProjectDetail,
  importProjectVariables,
  markProjectInjected,
  upsertProject,
} from "@/lib/vault";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const format = req.nextUrl.searchParams.get("format");

  if (format === "env" || format === "json") {
    try {
      const content = await exportProjectVariables(id, format);
      return NextResponse.json({ format, content });
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const detail = await getProjectDetail(id);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = await req.json();
  const { id } = await ctx.params;

  if (body.action === "inject") {
    try {
      const project = await markProjectInjected(id);
      return NextResponse.json(project);
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  if (!body?.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "Project name is required" }, { status: 400 });
  }

  const project = await upsertProject({
    id,
    name: body.name,
    description: body.description || "",
    color: body.color || "#38bdf8",
    status: body.status || "active",
    defaultShell: body.defaultShell || "zsh",
  });
  return NextResponse.json(project);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = await req.json();
  const { id } = await ctx.params;

  if (body?.action === "import") {
    const format = body.format === "json" ? "json" : "env";
    if (typeof body.content !== "string") {
      return NextResponse.json({ error: "content must be a string" }, { status: 400 });
    }
    try {
      const result = await importProjectVariables(id, format, body.content);
      return NextResponse.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteProject(id);
  return NextResponse.json({ ok: true });
}
