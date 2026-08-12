import { Link } from "react-router-dom";
import { Card } from "../components/Card";

export function NotFoundPage() {
  return (
    <Card className="mx-auto max-w-md py-12 text-center">
      <p className="font-display text-6xl">¶?</p>
      <h1 className="mt-3 text-2xl font-medium">Page not found</h1>
      <p className="mt-1 text-sm text-faint">This one isn't in the ledger.</p>
      <Link to="/" className="mt-4 inline-block rounded-full bg-moss px-4 py-2 text-sm font-semibold text-white hover:bg-moss-dark">Back home</Link>
    </Card>
  );
}
