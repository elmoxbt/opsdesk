import Link from "next/link";
import { NotFoundIllustration } from "@opsdesk/ui/illustrations";
import { Button } from "@opsdesk/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="flex max-w-sm flex-col items-center text-center">
        <NotFoundIllustration className="h-36 w-auto" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or was moved.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Go back to the dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
