import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const sCoreDream = localFont({
  src: [
    {
      path: "./fonts/S-CoreDream-4Regular.woff",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/S-CoreDream-5Medium.woff",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/S-CoreDream-7ExtraBold.woff",
      weight: "700",
      style: "normal",
    },
    {
      path: "./fonts/S-CoreDream-8Heavy.woff",
      weight: "800",
      style: "normal",
    },
  ],
  variable: "--font-s-core-dream",
  display: "swap",
});

export const metadata: Metadata = {
  title: "미래항공모빌리티 운항 훈련",
  description:
    "USB 조종기로 Mode 2 비행 훈련, 조종 자격시험과 항공모빌리티 임무를 체험하는 교육용 시뮬레이터입니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={sCoreDream.variable}>
      <body>{children}</body>
    </html>
  );
}
