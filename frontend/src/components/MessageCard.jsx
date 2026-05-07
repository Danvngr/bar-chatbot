export default function MessageCard({ title, content, meta }) {
  return (
    <article className="rounded border bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{content}</p>
      {meta ? <p className="mt-2 text-xs text-slate-500">{meta}</p> : null}
    </article>
  );
}
