import { NextRequest, NextResponse } from "next/server";
import { ProjectStatus } from "@/lib/models";
import { listProjectSummaries, upsertProject } from "@/lib/vault";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  const statusParam = (req.nextUrl.searchParams.get("status") || "all") as ProjectStatus | "all";
  const status = statusParam === "active" || statusParam === "disabled" || statusParam === "system" ? statusParam : "all";
  return NextResponse.json(await listProjectSummaries({ q, status }));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body?.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "Project name is required" }, { status: 400 });
  }

  const project = await upsertProject({
    id: body.id,
    name: body.name,
    description: body.description || "",
    color: body.color || "#38bdf8",
    status: body.status || "active",
    defaultShell: body.defaultShell || "zsh",
  });
  return NextResponse.json(project);
}
