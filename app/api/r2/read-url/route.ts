import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

    // 投稿を取得。
    // RLSも通るので、その参加者が閲覧できる投稿だけ取得できる。
    const { data: post, error: postError } = await supabase
      .from("posts")
      .select(
        "id,event_id,storage_provider,r2_object_key,deleted_at",
      )
      .eq("id", postId)
      .maybeSingle();

    if (
      postError ||
      !post ||
      post.deleted_at ||
      post.storage_provider !== "r2" ||
      !post.r2_object_key
    ) {
      return NextResponse.json(
        { error: "R2 image not available." },
        { status: 404 },
      );
    }

    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: post.r2_object_key,
    });

    const signedUrl = await getSignedUrl(r2, command, {
      expiresIn: 60 * 60,
    });

    return NextResponse.json({
      signedUrl,
    });
  } catch (error) {
    console.error("R2 read URL error:", error);

    return NextResponse.json(
      { error: "Could not create image URL." },
      { status: 500 },
    );
  }
}