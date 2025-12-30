import ComponentCard from "@/components/common/ComponentCard";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import ChampionTablePanel from "@/components/tables/ChampionTablePanel";
import { getChampionTierList } from "@/services/championData";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Next.js Basic Table | TailAdmin - Next.js Dashboard Template",
  description:
    "This is Next.js Basic Table  page for TailAdmin  Tailwind CSS Admin Dashboard Template",
};

export default async function BasicTables() {
  const champions = await getChampionTierList();

  return (
    <div>
      <PageBreadcrumb pageTitle="챔피언 리스트" />
      <div className="space-y-6">
        <ComponentCard title="Basic Table 1">
          <ChampionTablePanel champions={champions} />
        </ComponentCard>
      </div>
    </div>
  );
}
