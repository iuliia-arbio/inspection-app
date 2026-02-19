import { getDealsWithApartments } from "@/lib/data";
import DealSelectionClient from "./DealSelectionClient";

export const dynamic = "force-dynamic";

export default async function DealSelectionPage() {
  const deals = await getDealsWithApartments();

  return <DealSelectionClient deals={deals} />;
}
