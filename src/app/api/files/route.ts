import { NextRequest, NextResponse } from "next/server";
import { listFiles, saveFile } from "@/lib/vault";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const files = await listFiles();
  if (!projectId) return NextResponse.json(files);
  return NextResponse.json(files.filter((file) => file.projectId === projectId));
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File;
  const project = form.get("project")?.toString();
  const projectId = form.get("projectId")?.toString();
  const tags = (form.get("tags")?.toString() || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const saved = await saveFile({
    buffer,
    originalName: file.name,
    mimeType: file.type,
    project,
    projectId,
    tags,
  });

  return NextResponse.json(saved);
}
