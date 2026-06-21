import { SettingsPanel } from "@/components/settings-panel";

export const metadata = {
  title: "Settings - Kanban Tools",
};

export default function SettingsPage() {
  return (
    <div className="container max-w-3xl py-12">
      <header className="mb-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Preferences
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-2 text-muted-foreground">
          Personalize the app and see what your server can do.
        </p>
      </header>
      <SettingsPanel />
    </div>
  );
}
