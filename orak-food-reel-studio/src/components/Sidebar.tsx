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
    <aside className="w-60 shrink-0 border-r border-gray-200 bg-white px-3 py-5 flex flex-col gap-1">
      <Link href="/" className="flex items-center gap-2 px-3 pb-4">
        <span className="text-2xl">🥟</span>
        <div>
          <div className="font-extrabold text-lg leading-tight">오락푸드</div>
          <div className="text-xs text-gray-500">AI 릴스 스튜디오</div>
        </div>
      </Link>
      {MENU.map((m) => {
        const active = pathname === m.href || (m.href !== "/" && pathname.startsWith(m.href));
        return (
          <Link
            key={m.href}
            href={m.href}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition ${
              active ? "bg-[#FDEDE5] text-[#E86A3A]" : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            <span className="text-lg w-6 text-center">{m.icon}</span>
            {m.label}
          </Link>
        );
      })}
      <div className="mt-auto px-3 pt-4 text-[11px] text-gray-400">
        @orak_food · 신림/관악구
        <br />주 6회 (월~토) 운영
      </div>
    </aside>
  );
}
