import "./globals.css";

export const metadata = {
  title: "My Diary",
  description: "A personal diary.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
