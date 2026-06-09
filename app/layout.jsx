import './globals.css'

export const metadata = {
  title: 'GMGN Trenches Scanner',
  description: 'Solana meme coin screening tool',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
