import { useState } from "react";
import api from "../services/api";

const initialKb = [
  { category: "hours", content: "" },
  { category: "kosher", content: "" },
  { category: "address", content: "" },
  { category: "menu", content: "" },
];

export default function Onboarding() {
  const [form, setForm] = useState({
    restaurant_id: "",
    name: "",
    phone_number: "",
    admin_phone: "",
    whatsapp_phone_number_id: "",
    system_prompt_base: "ענה רק בנושאים שקשורים למסעדה.",
  });
  const [knowledgeBase, setKnowledgeBase] = useState(initialKb);
  const [status, setStatus] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setStatus("Submitting...");
    try {
      await api.post("/onboarding", { ...form, knowledge_base: knowledgeBase });
      setStatus("Provisioning completed.");
    } catch {
      setStatus("Provisioning failed.");
    }
  };

  return (
    <section>
      <h1 className="mb-4 text-2xl font-bold">Onboarding</h1>
      <form className="space-y-3 rounded border bg-white p-4" onSubmit={onSubmit}>
        {Object.keys(form).map((field) => (
          <input
            key={field}
            className="w-full rounded border p-2"
            placeholder={field}
            value={form[field]}
            onChange={(e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))}
            required={field !== "whatsapp_phone_number_id"}
          />
        ))}
        <h2 className="pt-2 text-lg font-semibold">Knowledge Base Seed</h2>
        {knowledgeBase.map((item, index) => (
          <div key={`${item.category}-${index}`} className="rounded border p-2">
            <p className="text-sm font-medium">{item.category}</p>
            <textarea
              className="mt-1 w-full rounded border p-2"
              rows={2}
              value={item.content}
              onChange={(e) =>
                setKnowledgeBase((prev) =>
                  prev.map((x, i) => (i === index ? { ...x, content: e.target.value } : x))
                )
              }
            />
          </div>
        ))}
        <button className="rounded bg-slate-900 px-4 py-2 text-white" type="submit">
          Create Restaurant
        </button>
        {status ? <p className="text-sm">{status}</p> : null}
      </form>
    </section>
  );
}
