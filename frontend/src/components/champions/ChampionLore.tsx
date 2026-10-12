export default function ChampionLore({ lore }: { lore: string }) {
  return (
    <section aria-labelledby="lore-heading" className="space-y-4">
      <h2 id="lore-heading" className="text-xl font-bold">
        스토리
      </h2>
      <p className="rounded-lg border border-border bg-surface p-4 leading-relaxed whitespace-pre-line text-foreground/90 sm:p-6">
        {lore}
      </p>
    </section>
  );
}
