import Nav from "@/components/Nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 px-5 py-6 pb-20 md:pb-6 md:px-10 md:py-8 max-w-4xl">
        {children}
      </main>
    </div>
  );
}
