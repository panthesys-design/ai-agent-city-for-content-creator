import Image from 'next/image';
import creatorCity from '@/docs/assets/creator-city.svg';
import headquartersStyles from '@/docs/assets/headquarters-styles.svg';
import agentCreationFlow from '@/docs/assets/agent-creation-flow.svg';

const illustrations = [
  { image: creatorCity, alt: 'Creator City overview: headquarters, an agent office, and a growing team.' },
  { image: headquartersStyles, alt: 'Empire, Crown, and Twin headquarters building styles.' },
  { image: agentCreationFlow, alt: 'Agent creation flow from the dialog draft through host state to the city canvas.' },
];

export default function Home() {
  return (
    <main className="min-h-dvh bg-[#f7f8fa] px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 sm:gap-10">
        {illustrations.map(({ image, alt }, index) => (
          <Image key={alt} src={image} alt={alt} unoptimized
            preload={index === 0} className="h-auto w-full rounded-2xl" />
        ))}
      </div>
    </main>
  );
}
