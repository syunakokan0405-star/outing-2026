import { NextResponse } from "next/server";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

import { createClient } from "@/lib/supabase/server";
import { r2, R2_BUCKET_NAME } from "@/lib/r2";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized." },
        { status: 401 },
      );
    }

    const body = await request.json();
    const postId = String(body.postId ?? "");

    if (!postId) {
      return NextResponse.json(
        { error: "Missing post ID." },
        { status: 400 },
      );
    }

    // 投稿と投稿者を確認
    const { data: post, error: postError } = await supabase
      .from("posts")
      .select(
        "id,participant_id,storage_provider,r2_object_key,deleted_at",
      )
      .eq("id", postId)
      .maybeSingle();

    if (
      postError ||
      !post ||
      !post.deleted_at ||
      post.storage_provider !== "r2" ||
      !post.r2_object_key
    ) {
      return NextResponse.json(
        { error: "R2 image not available for deletion." },
        { status: 404 },
      );
    }

    // 本人の投稿か確認
    const { data: participant, error: participantError } =
      await supabase
        .from("participants")
        .select("id")
        .eq("id", post.participant_id)
        .eq("auth_user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

    if (participantError || !participant) {
      return NextResponse.json(
        { error: "Forbidden." },
        { status: 403 },
      );
    }

    await r2.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: post.r2_object_key,
      }),
    );

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("R2 delete error:", error);

    return NextResponse.json(
      { error: "Could not delete R2 image." },
      { status: 500 },
    );
  }
}