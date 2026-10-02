import LoginForm from "@/components/LoginForm";

export const metadata = { title: "Unlock · AIWish" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink-950 p-6">
      <div className="w-full space-y-6 text-center">
        <div className="space-y-2">
          <p className="text-5xl">✨</p>
          <h1 className="text-2xl font-semibold text-ink-200">AIWish</h1>
          <p className="text-sm text-ink-400">Private access. Enter your passcode.</p>
        </div>
        <div className="flex justify-center">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}