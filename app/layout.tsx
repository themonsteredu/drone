import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "바이로봇 가상 드론 조종 테스트",
  description:
    "바이로봇 USB 조종기를 연결해 스틱과 버튼을 확인하고 가상 드론 한 대를 조종하는 기초 시뮬레이터입니다.",
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
