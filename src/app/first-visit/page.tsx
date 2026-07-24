import Link from 'next/link';
import { ArrowLeftIcon } from '@/components/icons';
import MyVisits from './MyVisits';
import { EditSurveyButton } from '@/components/firstVisit/EditSurveyButton';

export const dynamic = 'force-dynamic';

export default function FirstVisitLanding() {
  return (
    <main className="mx-auto max-w-md p-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 min-h-[44px]"
      >
        <ArrowLeftIcon className="h-4 w-4" /> Back to mode picker
      </Link>
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-semibold">First Visit Survey</h1>
        {/* Survey editor lives here, on the main screen — not inside an
            individual inspection (where changing the survey mid-walkthrough is
            confusing). */}
        <EditSurveyButton />
      </div>
      <Link
        href="/first-visit/new"
        className="mt-4 block rounded-md bg-black px-4 py-2 text-center text-white"
      >
        Start a new visit
      </Link>
      <h2 className="mt-8 text-sm font-medium text-gray-600">My visits</h2>
      <MyVisits />
    </main>
  );
}
