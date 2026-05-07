import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";

export default function KnowledgeBase() {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("custom");
  const [content, setContent] = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["knowledge-base"],
    queryFn: async () => (await api.get("/admin/knowledge-base")).data,
  });

  const mutation = useMutation({
    mutationFn: async () => api.post("/admin/knowledge-base", { category, content }),
    onSuccess: () => {
      setContent("");
      queryClient.invalidateQueries({ queryKey: ["knowledge-base"] });
    },
  });

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Knowledge Base</h1>
      <form
        className="space-y-2 rounded border bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <select className="rounded border p-2" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="hours">hours</option>
          <option value="kosher">kosher</option>
          <option value="address">address</option>
          <option value="menu">menu</option>
          <option value="rules">rules</option>
          <option value="event">event</option>
          <option value="promotion">promotion</option>
          <option value="custom">custom</option>
        </select>
        <textarea
          className="block w-full rounded border p-2"
          rows={3}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Business rule or answer text"
          required
        />
        <button className="rounded bg-slate-900 px-4 py-2 text-white" type="submit">
          Add Item
        </button>
      </form>

      {isLoading ? <p>Loading...</p> : null}
      <ul className="space-y-2">
        {data.map((item) => (
          <li key={item.id} className="rounded border bg-white p-3">
            <p className="text-sm font-semibold">{item.category}</p>
            <p className="text-sm text-slate-700">{item.content}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
