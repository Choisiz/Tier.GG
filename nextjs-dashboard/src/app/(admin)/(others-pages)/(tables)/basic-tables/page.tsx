import ComponentCard from "@/components/common/ComponentCard";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import BasicTableOne from "@/components/tables/BasicTableOne";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Next.js Basic Table | TailAdmin - Next.js Dashboard Template",
  description:
    "This is Next.js Basic Table  page for TailAdmin  Tailwind CSS Admin Dashboard Template",
  // other metadata
};

interface ChampionImageData {
  name: string;
  url: string;
}

interface ApiResponse {
  championImageUrls: ChampionImageData[];
}

async function Champion_images() {
  
      const response = await fetch('http://localhost:3001/api/champion_images?version=15.11.1&lang=ko_KR');
      
      if (!response.ok) {
        throw new Error('API 호출 실패');
      }
      
      const data: ApiResponse = await response.json();
      return(
       <>
       <BasicTableOne champions={data.championImageUrls}/>
       </>
      )
};

export default function BasicTables() {
  return (
    <div>
      <PageBreadcrumb pageTitle="챔피언 리스트" />
      <div className="space-y-6">
        <ComponentCard title="Basic Table 1">
          <Champion_images />
        </ComponentCard>
      </div>
    </div>
  );
}
