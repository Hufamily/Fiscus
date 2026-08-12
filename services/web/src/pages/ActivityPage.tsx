import { useEffect, useState } from "react";
import { api } from "../api";
import type { ActivityEvent } from "../types";
import { Card } from "../components/Card";
import { ActivityFeed } from "../components/ActivityFeed";

export function ActivityPage() {
  const [activity, setActivity] = useState<ActivityEvent[] | null>(null);
  useEffect(() => { api.getActivity().then(setActivity); }, []);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Activity log</h1>
        <p className="mt-1 text-sm text-slate-500">
          Append-only audit trail. Every human and agent action is recorded (charter section 5).
        </p>
      </div>
      <Card>{activity ? <ActivityFeed events={activity} /> : <p className="text-sm text-slate-400">Loading…</p>}</Card>
    </div>
  );
}
