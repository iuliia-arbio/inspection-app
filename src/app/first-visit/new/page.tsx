import Link from 'next/link';
import { ArrowLeftIcon } from '@/components/icons';
import DealPicker from './DealPicker';
import { listFirstVisitDeals } from '@/lib/firstVisit/deals';

export const dynamic = 'force-dynamic';

export default async function NewVisitPage() {
  // Query the hub directly — never fetch our own API route from a server
  // component (it's behind auth middleware and needs an absolute URL, which
  // crashed prod). listFirstVisitDeals never throws, so this page can't 500.
  const deals = await listFirstVisitDeals();
  return (
    <main className="mx-auto max-w-md p-6">
      <Link
        href="/first-visit"
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 min-h-[44px]"
      >
        <ArrowLeftIcon className="h-4 w-4" /> Back to my visits
      </Link>
      <h1 className="text-xl font-semibold">Pick a deal</h1>
      <DealPicker deals={deals} />
    </main>
  );
}
