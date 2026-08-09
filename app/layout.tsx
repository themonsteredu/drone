import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BYROBOT Controller Diagnostics",
  description:
    "Gamepad와 Web Serial로 바이로봇 USB 조종기의 연결, RAW 데이터, 패킷, 입력 상태를 단계별로 진단합니다.",
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
