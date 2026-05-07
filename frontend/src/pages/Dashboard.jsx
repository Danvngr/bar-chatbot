import { useQuery } from "@tanstack/react-query";
import api from "../services/api";

export default function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get("/admin/dashboard")).data,
  });

  if (isLoading) return <p>Loading dashboard...</p>;
  if (error) return <p>Failed to load dashboard.</p>;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded border bg-white p-4">
          <p className="text-sm text-slate-600">Restaurant</p>
          <p className="text-lg font-semibold">{data?.restaurant?.name || "Not configured"}</p>
        </div>
        <div className="rounded border bg-white p-4">
          <p className="text-sm text-slate-600">Pending Escalations</p>
          <p className="text-lg font-semibold">{data?.pending_questions || 0}</p>
        </div>
      </div>
    </section>
  );
}
