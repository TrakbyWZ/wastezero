import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">
        The page you are looking for does not exist.
      </p>
      <Link
        href="/"
        className="text-sm font-medium text-primary underline underline-offset-4 hover:no-underline"
      >
        Return home
      </Link>
    </div>
  );
}
