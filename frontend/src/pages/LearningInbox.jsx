import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import MessageCard from "../components/MessageCard";

export default function LearningInbox() {
  const [answers, setAnswers] = useState({});
  const queryClient = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ["learning-inbox"],
    queryFn: async () => (await api.get("/admin/learning-inbox")).data,
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, answer }) => api.post(`/admin/learning-inbox/${id}/resolve`, { answer }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["learning-inbox"] }),
  });

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Learning Inbox</h1>
      {isLoading ? <p>Loading...</p> : null}
      {data.map((item) => (
        <div key={item.id} className="space-y-2 rounded border bg-white p-4">
          <MessageCard
            title={`Question from ${item.phone_number}`}
            content={item.user_message}
            meta={`Status: ${item.status}`}
          />
          <textarea
            className="w-full rounded border p-2"
            rows={3}
            placeholder="Admin answer"
            value={answers[item.id] || ""}
            onChange={(e) => setAnswers((prev) => ({ ...prev, [item.id]: e.target.value }))}
          />
          <button
            type="button"
            className="rounded bg-slate-900 px-4 py-2 text-white"
            onClick={() => resolveMutation.mutate({ id: item.id, answer: answers[item.id] })}
            disabled={!answers[item.id]}
          >
            Resolve & Inject
          </button>
        </div>
      ))}
    </section>
  );
}
