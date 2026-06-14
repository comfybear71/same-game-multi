import type { Metadata, Viewport } from "next";

import { Nav } from "@/components/Nav";
import { auth } from "@/lib/auth";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "AFL Multi Tracker",
  description: "AFL same-game multi prediction and bet tracking.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0f17",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  return (
    <html lang="en">
      <body>
        <Providers>
          <Nav email={session?.user?.email} />
          <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
