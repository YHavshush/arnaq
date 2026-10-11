import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-4xl tracking-tight">Kasboek</h1>
      <p className="text-ink-muted">
        Het ontwerpsysteem staat (zie DESIGN.md). Het dashboard volgt in de volgende stap.
      </p>
      <div>
        <Button disabled>CSV uploaden</Button>
      </div>
    </main>
  );
}
