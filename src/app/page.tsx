import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Budget Tracker</h1>
      <p className="text-muted-foreground">
        Scaffold is up. CSV import comes in the next milestone.
      </p>
      <div>
        <Button disabled>Upload CSV</Button>
      </div>
    </main>
  );
}
