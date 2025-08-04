

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  
    try {
        //1. params로 puuId찾기
        //2. puuId로 게임전적찾기(10개)
        //3. 10개모두 게임전적id검색하기
    } catch (e) {}

  return (
    <div>
          {params.q}
    </div>
  );
}