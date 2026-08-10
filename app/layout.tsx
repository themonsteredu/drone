import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "미래항공모빌리티 운항 훈련",
  description:
    "바이로봇 USB 조종기로 Mode 2 비행 훈련, 조종 자격시험과 항공모빌리티 임무를 체험하는 교육용 시뮬레이터입니다.",
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
