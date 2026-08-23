import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "오락푸드 AI 릴스 스튜디오",
  description: "맛집 입력부터 Instagram Reels 발행까지 — 만두탐정 오락이와 함께",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <ToastProvider>
          <div className="flex min-h-screen flex-col md:flex-row">
            <Sidebar />
            <main className="flex-1 min-w-0 px-4 py-5 md:px-8 md:py-6 max-w-[1440px]">{children}</main>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
