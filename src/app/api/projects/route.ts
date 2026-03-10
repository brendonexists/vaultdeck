import { NextRequest, NextResponse } from "next/server";
import { listProjects, upsertProject } from "@/lib/vault";

export async function GET() {
  return NextResponse.json(await listProjects());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const project = await upsertProject({
    id: body.id,
    name: body.name,
    description: body.description,
    color: body.color || "#7c3aed",
    icon: body.icon || "◈",
  });
  return NextResponse.json(project);
}
