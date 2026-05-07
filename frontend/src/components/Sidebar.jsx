import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

const links = [
  { to: "/", label: "Dashboard" },
  { to: "/onboarding", label: "Onboarding" },
  { to: "/knowledge-base", label: "Knowledge Base" },
  { to: "/learning-inbox", label: "Learning Inbox" },
];

export default function Sidebar() {
  const { pathname } = useLocation();
  const { logout } = useAuth();

  return (
    <aside className="w-64 border-r bg-white p-4">
      <h2 className="mb-4 text-xl font-semibold">Restaurant Admin</h2>
      <nav className="space-y-2">
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={`block rounded px-3 py-2 ${
              pathname === link.to ? "bg-slate-900 text-white" : "hover:bg-slate-100"
            }`}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <button className="mt-8 w-full rounded border px-3 py-2" onClick={logout} type="button">
        Logout
      </button>
    </aside>
  );
}
