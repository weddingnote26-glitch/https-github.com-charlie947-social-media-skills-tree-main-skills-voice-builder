"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** §48 왼쪽 메뉴 */
const MENU = [
  { href: "/", icon: "🏠", label: "홈" },
  { href: "/today", icon: "✨", label: "오늘의 릴스" },
  { href: "/week", icon: "🗓", label: "이번 주 6개" },
  { href: "/calendar", icon: "📅", label: "콘텐츠 캘린더" },
  { href: "/producing", icon: "🎬", label: "제작중" },
  { href: "/library", icon: "✅", label: "완성 콘텐츠" },
  { href: "/publish", icon: "🚀", label: "예약/발행" },
  { href: "/analytics", icon: "📊", label: "성과분석" },
  { href: "/restaurants", icon: "🍽", label: "맛집 DB" },
  { href: "/benchmark", icon: "🔍", label: "릴스 벤치마킹" },
  { href: "/character", icon: "🥟", label: "만두탐정 오락이" },
  { href: "/settings", icon: "⚙️", label: "설정" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    // 메뉴가 화면보다 길어지면 아래 항목(설정 등)이 잘려 보였다.
    // 화면에 고정하고, 넘칠 때는 본문이 아니라 메뉴 자체가 스크롤되게 한다.
    <aside className="shrink-0 bg-white sticky top-0 z-20 overscroll-contain
      w-full border-b border-gray-200 px-3 py-2 flex flex-row items-center gap-1 overflow-x-auto
      md:w-60 md:h-screen md:border-b-0 md:border-r md:py-4 md:flex-col md:items-stretch md:gap-0.5 md:overflow-y-auto">
      <Link href="/" className="flex items-center gap-2 px-3 md:pb-3 shrink-0">
        <span className="text-2xl">🥟</span>
        <div className="hidden md:block">
          <div className="font-extrabold text-lg leading-tight">오락푸드</div>
          <div className="text-xs text-gray-600">AI 릴스 스튜디오</div>
        </div>
      </Link>
      {MENU.map((m) => {
        const active = pathname === m.href || (m.href !== "/" && pathname.startsWith(m.href));
        return (
          <Link
            key={m.href}
            href={m.href}
            // shrink-0 이 없으면 세로 공간이 모자랄 때 항목들이 눌려 글자가 겹친다
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition shrink-0 whitespace-nowrap ${
              active ? "bg-[#FDEDE5] text-[#B84A1B]" : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            <span className="text-lg w-6 text-center shrink-0">{m.icon}</span>
            {m.label}
          </Link>
        );
      })}
      <div className="hidden md:block mt-auto px-3 pt-4 text-xs text-gray-600 shrink-0">
        @orak_food · 신림/관악구
        <br />주 6회 (월~토) 운영
      </div>
    </aside>
  );
}
