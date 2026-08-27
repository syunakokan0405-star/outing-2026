import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Missions() {
  const supabase = await createClient();

  const eventId = process.env.NEXT_PUBLIC_EVENT_ID;

  if (!eventId) {
    return (
      <main className="shell grid">
        <section className="card">
          <h2>設定エラー</h2>
          <p>NEXT_PUBLIC_EVENT_ID が設定されていません。</p>
        </section>
      </main>
    );
  }

  // 今ログインしている参加者を取得
  const { data: me, error: meError } = await supabase.rpc(
    "get_my_participant",
    {
      p_event_id: eventId,
    }
  );

  if (meError) {
    return (
      <main className="shell grid">
        <section className="card">
          <h2>参加者情報を取得できませんでした</h2>
          <p>{meError.message}</p>
        </section>
      </main>
    );
  }

  const participant = Array.isArray(me) ? me[0] : me;

  if (!participant?.participant_id) {
    redirect("/join");
  }

  // 自分に配られたMission一覧
  const { data: assignments, error: assignmentError } = await supabase
    .from("mission_assignments")
    .select(`
      id,
      first_cleared_at,
      mission:missions (
        id,
        title,
        difficulty,
        points,
        required_mentions,
        drop:mission_drops (
          event_id,
          status,
          drop_number
        )
      )
    `)
    .eq("participant_id", participant.participant_id)
    .order("created_at", { ascending: false });

  if (assignmentError) {
    return (
      <main className="shell grid">
        <section className="card">
          <h2>Missionを取得できませんでした</h2>
          <p>{assignmentError.message}</p>
        </section>
      </main>
    );
  }

  const missions =
    assignments
      ?.filter((assignment: any) => {
        const mission = assignment.mission;
        const drop = mission?.drop;

        return (
          mission &&
          drop &&
          drop.event_id === eventId &&
          drop.status === "published"
        );
      })
      .map((assignment: any) => ({
        assignmentId: assignment.id,
        cleared: Boolean(assignment.first_cleared_at),
        id: assignment.mission.id,
        title: assignment.mission.title,
        difficulty: assignment.mission.difficulty,
        points: assignment.mission.points,
        requiredMentions: assignment.mission.required_mentions,
        dropNumber: assignment.mission.drop.drop_number,
      })) ?? [];

  return (
    <main className="shell grid">
      <div>
        <div className="brand">OUTING 2026</div>
        <h1>Photo Mission</h1>
      </div>

      {missions.length === 0 && (
        <section className="card">
          <h2>現在Missionはありません</h2>
          <p className="muted">
            新しいDropが配布されるとここに表示されます。
          </p>
        </section>
      )}

      {missions.map((mission) => {
        const params = new URLSearchParams({
          title: mission.title,
          points: String(mission.points),
          missionId: mission.id,
          eventId,
        });

        const cameraHref = `/camera?${params.toString()}`;

        return (
          <section
            key={mission.assignmentId}
            className="card"
            style={{
              opacity: mission.cleared ? 0.45 : 1,
            }}
          >
            <span>
              {mission.difficulty.charAt(0).toUpperCase() +
                mission.difficulty.slice(1)}
              {" · "}
              +{mission.points}pt
            </span>

            <h2>{mission.title}</h2>

            <p className="muted">
              メンション {mission.requiredMentions}人以上
            </p>

            {mission.cleared && (
              <>
                <b>CLEAR ✓</b>
                <p>再撮影OK・追加得点なし</p>
              </>
            )}

            <Link
              className="btn primary linkButton"
              href={cameraHref}
            >
              カメラを開く
            </Link>
          </section>
        );
      })}
    </main>
  );
}