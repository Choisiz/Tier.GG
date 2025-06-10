import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "../ui/table";

import Image from "next/image";
interface ChampionImageData {
  name: string;
  url: string;
}

interface BasicTableOneProps {
  champions?: ChampionImageData[];
}

export default function BasicTableOne({ champions = [] }: BasicTableOneProps) {

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      <div className="max-w-full overflow-x-auto">
        <div className="min-w-[1102px]">
          <Table>
            {/* Table Header */}
            <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
              <TableRow>
                <TableCell
                  isHeader
                  className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                >
                  Id
                </TableCell>
                <TableCell
                  isHeader
                  className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                >
                   Champion
                </TableCell>
                <TableCell
                  isHeader
                  className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                >
                  Name
                </TableCell>
                <TableCell
                  isHeader
                  className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                >
                  Status
                </TableCell>
                <TableCell
                  isHeader
                  className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                >
                  Budget
                </TableCell>
              </TableRow>
            </TableHeader>

              {/* Table Body */}
              <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {champions.map((champion, index) => (
                <TableRow key={champion.name}>
                  <TableCell className="px-5 py-4 text-start">
                    <span className="text-gray-500 text-theme-sm dark:text-gray-400">
                      {index + 1}
                    </span>
                  </TableCell>
                  <TableCell className="px-5 py-4 text-start">
                    <div className="w-12 h-12 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                      <Image
                        width={48}
                        height={48}
                        src={champion.url}
                        alt={champion.name}
                        className="w-full h-full object-cover"                   
                      />
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-start">
                    <span className="font-medium text-gray-800 text-theme-sm dark:text-white/90">
                      {champion.name}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-start">
                    <span className="text-gray-500 text-theme-xs dark:text-gray-400 truncate max-w-xs block">
                      {champion.url}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

         {/* 총 챔피언 수 표시 */}
         <div className="px-5 py-3 border-t border-gray-100 dark:border-white/[0.05]">
        <span className="text-gray-500 text-theme-xs dark:text-gray-400">
          총 {champions.length}개의 챔피언
        </span>
      </div>
    </div>
  );
}
