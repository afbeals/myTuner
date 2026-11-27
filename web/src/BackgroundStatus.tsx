import { useEffect, useState } from "react";
import { useRemote } from "./ui";
export function BackgroundStatus() {
  const [tick, setTick] = useState(0);
  const status = useRemote<{
    active: string | null;
    waiting: number;
    paused: boolean;
    pauseDuringPlayback: boolean;
  }>("/api/admin/background", tick, true);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setTick((value) => value + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  if (!status.data || status.error) return null;
  const { active, waiting, paused, pauseDuringPlayback } = status.data;
  if (!paused && !active && !waiting) return null;
  return (
    <p className="notice" role="status">
      {paused
        ? "Optional library work is paused while someone is playing video. It resumes automatically after playback stops."
        : active
          ? "Optional library work is running one job at a time."
          : "Optional library work is waiting."}
      {waiting > 0 &&
        ` ${waiting} ${waiting === 1 ? "job is" : "jobs are"} queued.`}
      {!paused &&
        pauseDuringPlayback &&
        " Playback can pause this work between files."}
    </p>
  );
}

/** Per-task admission comes from the scheduler, rather than the global pause flag. */
export type WorkAdmission = {
  admission?: "waiting" | "active" | null;
  waitingReason?: "playback" | "queue" | "playback-capacity" | null;
};
export function workAdmissionLabel(work: WorkAdmission) {
  if (work.admission !== "waiting") return null;
  return work.waitingReason === "playback"
    ? "Waiting for playback"
    : work.waitingReason === "playback-capacity"
      ? "Waiting for playback capacity"
      : "Waiting in queue";
}
export function WorkAdmissionNotice({ work }: { work: WorkAdmission }) {
  const label = workAdmissionLabel(work);
  if (!label) return null;
  return (
    <p className="notice" role="status">
      {label}.{" "}
      {work.waitingReason === "playback"
        ? "Optional work resumes automatically when playback stops. You can close this dialog."
        : work.waitingReason === "playback-capacity"
          ? "Generation resumes automatically when encoder capacity is available."
          : "Work starts automatically when earlier optional work finishes. You can close this dialog."}
    </p>
  );
}
