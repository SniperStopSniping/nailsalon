import { Sparkles } from 'lucide-react';

type LegalSection = {
  title: string;
  paragraphs: string[];
};

export function LusterLegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}) {
  return (
    <main className="min-h-screen bg-[#F8F3F0] px-5 py-10 text-stone-900">
      <article className="mx-auto max-w-3xl overflow-hidden rounded-[32px] border border-rose-100 bg-white shadow-[0_24px_70px_rgba(76,29,46,0.08)]">
        <header className="bg-gradient-to-br from-[#4C1D2E] via-[#8B1538] to-[#D6A34A] px-6 py-10 text-white sm:px-10">
          <a href="/owner" className="inline-flex items-center gap-2 text-sm font-semibold text-rose-100">
            <Sparkles size={17} />
            Luster
          </a>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 flex gap-1 text-sm text-rose-100">
            <span>Last updated:</span>
            <time>{updated}</time>
          </p>
        </header>
        <div className="space-y-8 px-6 py-8 sm:p-10">
          <p className="text-base leading-7 text-stone-600">{intro}</p>
          {sections.map(section => (
            <section key={section.title}>
              <h2 className="text-xl font-semibold text-stone-950">{section.title}</h2>
              <div className="mt-3 space-y-3">
                {section.paragraphs.map(paragraph => (
                  <p key={paragraph} className="text-sm leading-6 text-stone-600">{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
          <footer className="border-t border-stone-100 pt-6 text-sm text-stone-500">
            Questions can be sent to the Luster support address shown in the application or Google authorization screen.
          </footer>
        </div>
      </article>
    </main>
  );
}
