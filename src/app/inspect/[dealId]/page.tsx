import { getDealById } from "@/lib/data";
import UnitSelectionClient from "./UnitSelectionClient";

export const dynamic = "force-dynamic";

export default async function UnitSelectionPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const deal = await getDealById(dealId);

  return <UnitSelectionClient deal={deal} />;
}
