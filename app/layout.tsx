import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "배틀드론 조종기 테스트",
  description: "USB 게임패드의 스틱 축과 버튼 입력을 실시간으로 확인하는 배틀드론 진단 도구",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
